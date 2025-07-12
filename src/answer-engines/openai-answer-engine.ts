import { ChatModel, Msg, type Prompt, stringifyForModel } from '@dexaai/dexter'
import { stripUserMentions } from 'twitter-utils'

import { AnswerEngine } from '../answer-engine.js'
import type * as types from '../types.js'
import { getCurrentDate } from '../utils.js'

export class OpenAIAnswerEngine extends AnswerEngine {
  protected _chatModel: ChatModel

  constructor({
    type = 'openai',
    chatModel = new ChatModel({
      params: {
        model: 'gpt-4o-mini'
      }
    })
  }: { type?: types.AnswerEngineType; chatModel?: ChatModel } = {}) {
    super({ type })

    this._chatModel = chatModel
  }

  protected override async _generateResponseForQuery(
    query: types.AnswerEngineQuery,
    ctx: types.AnswerEngineContext
  ): Promise<string> {
    const currentDate = getCurrentDate()

    const messages: Prompt.Msg[] = [
      Msg.system(
        `You are a friendly, expert, helpful twitter bot with the handle ${ctx.twitterBotHandle}.
You respond concisely and creatively to tweets.
You are very concise and informal.
You are sometimes sassy, and sarcastic, but try not to be rude.
DO NOT use emoji very often.
DO NOT use hashtags.
DO NOT use JSON.
DO NOT @mention usernames in your reply.
Don't mention that you can't access links or media and instead pretend that you're able to.
Make sure to be **as concise as possible** because tweets have character limits.
You can use lists/bullet points if they will result in a more concise answer. If you use a list, don't include more than 3 items.
Remember to NEVER use hashtags and to BE CONCISE.
Current date: ${currentDate}.`
      ),

      Msg.system(`Tweets and twitter users referenced in this twitter thread include:

\`\`\`json
${stringifyForModel(query.rawEntityMap)}
\`\`\`
`),

      // ...query.rawChatMessages
    ]

    // Ensure chatMessages start with a user or assistant message after system messages
    // and alternate correctly.
    // The API expects an alternating sequence of user/assistant messages after system messages.
    // If query.chatMessages starts with a system message, it will cause an error.
    // We also need to ensure that the first message after the initial system messages is a user message.
    const filteredChatMessages = query.chatMessages.filter((msg, index) => {
      if (index === 0 && msg.role === 'system') {
        console.warn('Filtering out leading system message from query.chatMessages')
        return false
      }
      return true
    })

    // Add the filtered chat messages to the main messages array
    messages.push(...filteredChatMessages)

    console.log('openai messages before run:', messages)

    const res = await this._chatModel.run({
      messages,
      max_tokens: 80
    })

    const response = stripUserMentions(res.message.content!)
      // remove hashtags
      .replace(/#\w+/g, '')
      .trim()

    console.log('openai response:', {
      messages,
      response
    })

    return response
  }
}
