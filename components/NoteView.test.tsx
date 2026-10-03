import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { NoteView } from "./NoteView";

const srcs = (markdown: string, imageBase?: string) => [...renderToStaticMarkup(<NoteView markdown={markdown} imageBase={imageBase} />).matchAll(/<img src="([^"]*)"/g)].map((m) => m[1]);

test("a relative image link is shown from the feed's current read link, others stay as written", () => {
  const md = "![](a.png) ![](https://x.test/b.png) ![](/r/old/c.png) ![](//x.test/d.png)";
  expect(srcs(md, "/r/new/")).toEqual(["/r/new/a.png", "https://x.test/b.png", "/r/old/c.png", "//x.test/d.png"]);
  expect(srcs(md)[0]).toBe("a.png"); // no read link yet: nothing to resolve against
});
