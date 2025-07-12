import defaultKy, { type KyInstance } from 'ky'

export type ScrapeResult = {
  author: string
  byline: string
  /** The HTML for the main content of the page. */
  content: string
  description: string
  imageUrl: string
  lang: string
  length: number
  logoUrl: string
  /** The text for the main content of the page in markdown format. */
  markdownContent: string
  publishedTime: string
  /** The raw HTML response from the server. */
  rawHtml: string
  siteName: string
  /** The text for the main content of the page. */
  textContent: string
  title: string
}

interface FirecrawlScrapeData {
  content: string
  markdown: string
  html: string
  title: string
  description: string
  image: string
  ogImage: string
  author: string
  publishedDate: string
  sourceUrl: string
}

interface FirecrawlScrapeResponse {
  data: FirecrawlScrapeData
}

/**
 * This is a single endpoint API for scraping websites. It returns the HTML,
 * markdown, and plaintext for main body content of the page, as well as
 * metadata like title and description.
 *
 * It tries the simplest and fastest methods first, and falls back to slower
 * proxies and JavaScript rendering if needed.
 */
export class ScraperClient {
  readonly apiBaseUrl: string
  readonly apiKey?: string
  readonly ky: KyInstance

  constructor({
    apiBaseUrl = 'https://api.firecrawl.dev',
    apiKey = process.env.FIRECRAWL_API_KEY,
    ky = defaultKy
  }: {
    apiKey?: string
    apiBaseUrl?: string
    ky?: KyInstance
  } = {}) {
    if (!apiKey) {
      throw new Error('FIRECRAWL_API_KEY is required')
    }

    this.apiBaseUrl = apiBaseUrl
    this.apiKey = apiKey
    this.ky = ky.extend({
      prefixUrl: this.apiBaseUrl,
      headers: {
        'x-api-key': this.apiKey
      }
    })
  }

  async scrapeUrl(
    url: string,
    {
      timeout = 60000
    }: {
      timeout?: number
    } = {}
  ): Promise<ScrapeResult> {
    const response = (await this.ky
      .post('v1/scrape', {
        json: { url },
        timeout
      })
      .json()) as FirecrawlScrapeResponse

    const data = response.data

    return {
      author: data.author || '',
      byline: '', // Firecrawl does not provide byline directly
      content: data.content || '',
      description: data.description || '',
      imageUrl: data.image || data.ogImage || '',
      lang: '', // Firecrawl does not provide lang directly
      length: data.content?.length || 0,
      logoUrl: '', // Firecrawl does not provide logoUrl directly
      markdownContent: data.markdown || '',
      publishedTime: data.publishedDate || '',
      rawHtml: data.html || '',
      siteName: data.title || '', // Using title as a fallback for siteName
      textContent: data.content || '',
      title: data.title || ''
    }
  }
}
