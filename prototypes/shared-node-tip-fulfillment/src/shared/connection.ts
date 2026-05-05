export type SharedNodeConnection = {
  url: string
  apiKey: string
}

function trimTrailingPunctuation(value: string) {
  return value.replace(/[),.;\]]+$/g, '')
}

export function extractSharedNodeConnection(text: string): SharedNodeConnection | null {
  const urlMatch =
    text.match(/shared\s+node\s+url\s*:\s*(https?:\/\/[^\s]+)/i) ||
    text.match(/node\s+url\s*:\s*(https?:\/\/[^\s]+)/i) ||
    text.match(/(https?:\/\/[^\s]+)/i)

  const apiKeyMatch =
    text.match(/node\s+api\s+key\s*:\s*([^\s]+)/i) ||
    text.match(/api\s+key\s*:\s*([^\s]+)/i)

  if (!urlMatch || !apiKeyMatch) return null

  return {
    url: trimTrailingPunctuation(urlMatch[1]),
    apiKey: trimTrailingPunctuation(apiKeyMatch[1]),
  }
}
