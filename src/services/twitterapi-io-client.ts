import ky from 'ky'

import * as config from '../config.js'
import { BotError } from '../bot-error.js'

export interface TwitterApiIoUserMentionsResponse {
  tweets: TwitterApiIoTweet[]
  has_next_page: boolean
  next_cursor: string
  status: 'success' | 'error'
  message: string
}

export interface TwitterApiIoTweet {
  type: string
  id: string
  url: string
  text: string
  source: string
  retweetCount: number
  replyCount: number
  likeCount: number
  quoteCount: number
  viewCount: number
  createdAt: string
  lang: string
  bookmarkCount: number
  isReply: boolean
  inReplyToId?: string
  conversationId: string
  inReplyToUserId?: string
  inReplyToUsername?: string
  author: TwitterApiIoUser
  entities: {
    hashtags: {
      indices: number[]
      text: string
    }[]
    urls: {
      display_url: string
      expanded_url: string
      indices: number[]
      url: string
    }[]
    user_mentions: {
      id_str: string
      name: string
      screen_name: string
    }[]
  }
  quoted_tweet?: TwitterApiIoTweet
  retweeted_tweet?: TwitterApiIoTweet
}

export interface TwitterApiIoUser {
  type: string
  userName: string
  url: string
  id: string
  name: string
  isBlueVerified: boolean
  verifiedType: string
  profilePicture: string
  coverPicture: string
  description: string
  location: string
  followers: number
  following: number
  canDm: boolean
  createdAt: string
  favouritesCount: number
  hasCustomTimelines: boolean
  isTranslator: boolean
  mediaCount: number
  statusesCount: number
  withheldInCountries: string[]
  affiliatesHighlightedLabel: Record<string, any>
  possiblySensitive: boolean
  pinnedTweetIds: string[]
  isAutomated: boolean
  automatedBy: string
  unavailable: boolean
  message: string
  unavailableReason: string
  profile_bio: {
    description: string
    entities: {
      description: {
        urls: {
          display_url: string
          expanded_url: string
          indices: number[]
          url: string
        }[]
      }
      url: {
        urls: {
          display_url: string
          expanded_url: string
          indices: number[]
          url: string
        }[]
      }
    }
  }
}

export class TwitterApiIoClient {
  protected _ky: typeof ky

  constructor() {
    if (!config.twitterApiIoApiKey) {
      throw new Error('TwitterApiIoClient missing required "TWITTERAPI_IO_API_KEY"')
    }

    this._ky = ky.extend({
      prefixUrl: 'https://api.twitterapi.io',
      headers: {
        'X-API-Key': config.twitterApiIoApiKey
      }
    })
  }

  async getUserMentions(
    userName: string,
    sinceTime?: number,
    untilTime?: number,
    cursor?: string
  ): Promise<TwitterApiIoUserMentionsResponse> {
    try {
      const searchParams: Record<string, string> = {
        userName
      }
      if (sinceTime) {
        searchParams.sinceTime = sinceTime.toString()
      }
      if (untilTime) {
        searchParams.untilTime = untilTime.toString()
      }
      if (cursor) {
        searchParams.cursor = cursor
      }

      const res = await this._ky.get('twitter/user/mentions', { searchParams }).json<TwitterApiIoUserMentionsResponse>()

      if (res.status === 'error') {
        throw new BotError(`TwitterApiIo error: ${res.message}`, {
          type: 'twitter:unknown',
          isFinal: true
        })
      }

      return res
    } catch (err: any) {
      console.error('TwitterApiIoClient error', err.toString())
      throw new BotError(`TwitterApiIoClient error: ${err.message}`, {
        type: 'network',
        cause: err
      })
    }
  }
}