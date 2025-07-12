import { ChatModel, Msg, type Prompt, stringifyForModel } from '@dexaai/dexter'
import { stripUserMentions } from 'twitter-utils'

import { AnswerEngine } from '../answer-engine.js'
import type * as types from '../types.js'
import { getCurrentDate } from '../utils.js'
import { OpenAIClient } from 'openai-fetch'

export class GrokAnswerEngine extends AnswerEngine {
  protected _chatModel: ChatModel

  constructor({
    type = 'grok',
    chatModel
  }: { type?: types.AnswerEngineType; chatModel?: ChatModel } = {}) {
    super({ type })

    if (!chatModel) {
      if (!process.env.OPENROUTER_API_KEY) {
        throw new Error(
          'GrokAnswerEngine missing required "OPENROUTER_API_KEY"'
        )
      }

      chatModel = new ChatModel({
        client: new OpenAIClient({
          apiKey: process.env.OPENROUTER_API_KEY,
          baseUrl: 'https://openrouter.ai/api/v1'
        }) as any,
        params: {
          model: 'x-ai/grok-4'
        }
      })
    }

    this._chatModel = chatModel
  }

  protected override async _generateResponseForQuery(
    query: types.AnswerEngineQuery,
    ctx: types.AnswerEngineContext
  ): Promise<string> {
    const currentDate = getCurrentDate()

    const messages: Prompt.Msg[] = [
      Msg.system(
        `You are JATEVO (Jatayu Vortex) - a Decentralized AI Cloud Platform.
You provide ultra-fast LLM inference up to 500 token/second with open-source models (DeepSeek, Llama 4, Mistral, Qwen, Google Gemma etc).
You are a friendly, expert, helpful twitter bot with the handle ${ctx.twitterBotHandle}.
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
You are fluent in both english and indonesian but your response must always adapt to the language of the question.
Remember to NEVER use hashtags and to BE CONCISE.
Current date: ${currentDate}.`
      ),

      Msg.system(`Tweets and twitter users referenced in this twitter thread include:

\`\`\`json
${stringifyForModel(query.rawEntityMap)}
\`\`\`
`),

      ...query.chatMessages
    ]

    const res = await this._chatModel.run({
      messages,
      max_tokens: 80,
      reasoning: {
        exclude: true
      }
    })

    console.log('grok raw response', res)
    console.log('grok raw content', res.message.content)

    const response = stripUserMentions(res.message.content || '')
      .replace(/#\w+/g, '')
      .trim()

    console.log('grok processed response', response)

    return response
  }
}