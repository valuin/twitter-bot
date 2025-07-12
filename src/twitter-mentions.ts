import { BotError } from './bot-error.js'
import * as config from './config.js'
import * as db from './db.js'
import { messages } from './db.js'
import * as twitter from './twitter.js'
import { findTweetById } from './twitter.js'
import { handleKnownTwitterErrors, maxTwitterId } from './twitter-utils.js'
import type * as types from './types.js'
import { TwitterApiIoClient, type TwitterApiIoTweet } from './services/twitterapi-io-client.js'

/**
 * Fetches the latest mentions of the given `userId` on Twitter.
 *
 * NOTE: according to the twitter api docs, even with pagination and a paid API
 * plan, **only the 800 most recent Tweets can be retrieved**.
 *
 * @see https://developer.twitter.com/en/docs/twitter-api/tweets/timelines/api-reference/get-users-id-mentions
 */
export async function getTwitterUserIdMentions(
  userId: string,
  opts: types.TwitterUserIdMentionsQueryOptions,
  ctx: types.Context
): Promise<types.TweetMentionFetchResult> {
  const originalSinceMentionId = opts.since_id

  const result: types.TweetMentionFetchResult = {
    mentions: [],
    users: {},
    tweets: {},
    sinceMentionId: originalSinceMentionId
  }

  if (!ctx.noMentionsCache) {
    const cachedResult = await db.getCachedUserMentionsForUserSince({
      userId,
      sinceMentionId: originalSinceMentionId || '0'
    })

    if (cachedResult?.mentions.length > 0) {
      result.mentions = result.mentions.concat(cachedResult.mentions)
      result.users = {
        ...cachedResult.users,
        ...result.users
      }
      result.tweets = {
        ...cachedResult.tweets,
        ...result.tweets
      }

      result.sinceMentionId = maxTwitterId(
        result.sinceMentionId,
        cachedResult.sinceMentionId
      )

      console.log('tweets.usersIdMentions CACHE HIT', {
        originalSinceMentionId,
        sinceMentionId: result.sinceMentionId,
        numMentions: result.mentions.length
      })
    } else {
      console.log('tweets.usersIdMentions CACHE MISS', {
        originalSinceMentionId
      })
    }
  }

  const twitterApiIoClient = new TwitterApiIoClient()
  let useFallbackApi = false

  do {
    console.log('tweets.usersIdMentions', {
      sinceMentionId: result.sinceMentionId,
      useFallbackApi
    })

    try {
      if (useFallbackApi) {
        // Fallback API logic
        const fallbackResult = await twitterApiIoClient.getUserMentions(
          ctx.twitterBotHandle.replace('@', ''),
          // Convert since_id to unix timestamp in seconds if available
          opts.since_id ? Math.floor(new Date(parseInt(opts.since_id)).getTime() / 1000) : undefined,
          undefined, // untilTime not directly supported by current logic
          undefined // cursor not directly supported by current logic
        )

        if (fallbackResult.tweets?.length) {
          // Transform fallback API response to types.Tweet
          const transformedTweets: types.Tweet[] = fallbackResult.tweets.map((t: TwitterApiIoTweet) => ({
            id: t.id,
            text: t.text,
            author_id: t.author.id,
            created_at: new Date(t.createdAt).toISOString(),
            conversation_id: t.conversationId,
            in_reply_to_user_id: t.inReplyToUserId,
            referenced_tweets: t.inReplyToId ? [{ id: t.inReplyToId, type: 'replied_to' }] : undefined,
            public_metrics: {
              retweet_count: t.retweetCount,
              reply_count: t.replyCount,
              like_count: t.likeCount,
              quote_count: t.quoteCount,
              impression_count: t.viewCount // Map viewCount to impression_count
            },
            lang: t.lang,
            entities: {
              hashtags: t.entities?.hashtags?.map(h => ({
                start: h.indices[0]!,
                end: h.indices[1]!,
                tag: h.text
              })) || [],
              urls: t.entities?.urls?.map(u => ({
                start: u.indices[0]!,
                end: u.indices[1]!,
                url: u.url,
                display_url: u.display_url,
                expanded_url: u.expanded_url
              })) || [],
              mentions: t.entities?.user_mentions?.map(m => ({
                id: m.id_str,
                username: m.screen_name,
                start: 0, // Placeholder
                end: 0 // Placeholder
              })) || []
            },
            edit_history_tweet_ids: [] // Add this to satisfy the type
          }))

          result.mentions = result.mentions.concat(transformedTweets)
          console.log(`Fetched ${transformedTweets.length} mentions from fallback API. Total mentions: ${result.mentions.length}`)
          await db.upsertTweetMentionsForUserId(userId, transformedTweets)

          // Update users and tweets from fallback (simplified mapping)
          const transformedUsers: types.TwitterUser[] = fallbackResult.tweets.map(t => ({
            id: t.author.id,
            name: t.author.name,
            username: t.author.userName,
            profile_image_url: t.author.profilePicture,
            verified: t.author.isBlueVerified,
            public_metrics: {
              followers_count: t.author.followers,
              following_count: t.author.following,
              tweet_count: t.author.statusesCount,
              listed_count: 0 // Not available in fallback API
            },
            created_at: new Date(t.author.createdAt).toISOString(),
            description: t.author.description,
            location: t.author.location,
            url: t.author.url
          }))
          await db.upsertTwitterUsers(transformedUsers)

          for (const mention of transformedTweets) {
            result.sinceMentionId = maxTwitterId(
              result.sinceMentionId,
              mention.id
            )
          }
        }

        if (!fallbackResult.has_next_page || result.mentions.length >= 100) { // Limit to 100 mentions for fallback
          break
        }
      } else {
        // Primary Twitter API logic
        const mentionsQuery = twitter.usersIdMentions(userId, ctx, {
          max_results: 100,
          ...opts,
          since_id: result.sinceMentionId
        })

        let numMentionsInQuery = 0
        let numPagesInQuery = 0

        for await (const page of mentionsQuery) {
          numPagesInQuery++

          if (page.data?.length) {
            numMentionsInQuery += page.data?.length
            result.mentions = result.mentions.concat(page.data)
            console.log(`Fetched ${page.data.length} mentions from primary API. Total mentions: ${result.mentions.length}`)

            if (!ctx.noMentionsCache) {
              await db.upsertTweetMentionsForUserId(userId, page.data)
            }

            for (const mention of page.data) {
              result.sinceMentionId = maxTwitterId(
                result.sinceMentionId,
                mention.id
              )
            }
          }

          if (page.includes?.users) {
            const usersToUpsert = config.filterMentionsByVerified
              ? page.includes.users.filter((user: types.TwitterUser) => user.verified)
              : page.includes.users

            for (const user of usersToUpsert) {
              result.users[user.id] = user
            }

            await db.upsertTwitterUsers(Object.values(usersToUpsert))
          }

          if (page.includes?.tweets) {
            for (const tweet of page.includes.tweets) {
              result.tweets[tweet.id] = tweet
            }

            await db.upsertTweets(Object.values(page.includes.tweets))
          }
        }

        console.log({ numMentionsInQuery, numPagesInQuery })
        if (numMentionsInQuery < 5 || !ctx.resolveAllMentions) {
          break
        }
      }
    } catch (err: any) {
      console.error(
        'twitter error fetching user mentions:',
        err.status || err.error?.detail || err.toString()
      )

      if (err instanceof BotError && err.type === 'twitter:rate-limit') {
        console.warn('Twitter API rate limit hit, falling back to twitterapi.io')
        useFallbackApi = true
        // Continue loop to try fallback API
      } else if (result.mentions.length) {
        break
      } else {
        handleKnownTwitterErrors(err, { label: 'fetching tweet mentions' })

        throw new BotError(
          `Error fetching twitter user mentions: ${err.message}`,
          {
            type: 'twitter:unknown',
            cause: err
          }
        )
      }
    }
  } while (true)

  console.log(`Mentions before replied-to filter: ${result.mentions.length}`)

  // Filter out mentions that the bot has already replied to
  const filteredMentions: types.Tweet[] = []
  for (const mention of result.mentions) {
    const message = await messages.get(mention.id)
    if (!message || !message.responseTweetId) {
      filteredMentions.push(mention)
    }
  }
  result.mentions = filteredMentions
  console.log(`Mentions after replied-to filter: ${result.mentions.length}`)

  // Filter out mentions older than 10 minutes
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000 // 10 minutes in milliseconds
  const timeFilteredMentions: types.Tweet[] = []
  for (const mention of result.mentions) {
    const createdAt = new Date(mention.created_at!).getTime()
    if (createdAt >= tenMinutesAgo) {
      timeFilteredMentions.push(mention)
    }
  }
  result.mentions = timeFilteredMentions
  console.log(`Mentions after time filter: ${result.mentions.length}`)

  return result
}

/**
 * Recursively fetches the conversation history for a given tweet.
 */
export async function getConversationHistory(
  tweet: types.Tweet,
  ctx: types.Context,
  history: types.Tweet[] = []
): Promise<types.Tweet[]> {
  if (!tweet || history.some((t) => t.id === tweet.id)) {
    return history
  }

  history.unshift(tweet) // Add current tweet to the beginning of history

  if (tweet.referenced_tweets) {
    for (const ref of tweet.referenced_tweets) {
      if (ref.type === 'replied_to') {
        const parentTweet = await findTweetById(ref.id, ctx, {
          'tweet.fields': ['conversation_id', 'in_reply_to_user_id', 'referenced_tweets']
        })
        if (parentTweet?.data) {
          return getConversationHistory(parentTweet.data, ctx, history)
        }
      }
    }
  }

  return history
}
