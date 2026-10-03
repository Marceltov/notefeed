import { feedPath, locked } from "@/backend";

// The curl line that posts a note to the feed, with the credentials this instance and this feed ask for.
export function curlFor(base: string, feed: string, feedPassword: boolean): string {
  const auth = (locked() ? ` -H "Authorization: Bearer $NOTEFEED_PASSWORD"` : "") + (feedPassword ? ` -H "X-Feed-Password: $NOTEFEED_FEED_PASSWORD"` : "");
  return `curl${auth} -H "Content-Type: text/markdown" -d "# Hello" ${base}${feedPath(feed)}`;
}
