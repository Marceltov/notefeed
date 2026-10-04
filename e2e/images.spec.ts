import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const PNG = "e2e/fixtures/pixel.png";
const feedName = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const note = (page: Page) => page.getByLabel("Note in markdown");

async function post(page: Page, name: string, markdown: string) {
  await page.goto(`/${name}`);
  await note(page).fill(markdown);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: markdown.replace(/^# /, "").split("\n")[0] })).toBeVisible();
}

async function choose(page: Page, button: string, file: string | { name: string; mimeType: string; buffer: Buffer } | string[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: button }).click();
  await (await chooser).setFiles(file);
}

// Files dropped on the textarea, as a browser makes the event: the fixture PNG under each name.
async function drop(page: Page, ...names: string[]) {
  const png = readFileSync(PNG).toString("base64");
  await note(page).evaluate(
    (ta, { png, names }) => {
      const data = new DataTransfer();
      for (const name of names) data.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], name, { type: "image/png" }));
      ta.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    },
    { png, names },
  );
}

const loaded = (img: ReturnType<Page["locator"]>) => expect.poll(() => img.first().evaluate((i: HTMLImageElement) => i.naturalWidth));

test("a new feed offers the same box as any feed, with the password field and the image button", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await expect(note(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add image" })).toBeVisible();
  await expect(page.getByLabel("Password (optional, protects this feed)")).toBeVisible();
});

test("dropped images wait in the box; removing one takes its reference out; posting makes one note per image and the text", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await note(page).fill("# Pictured\n\nbefore");
  await drop(page, "cat.png", "dog.png");
  await expect(note(page)).toHaveValue(/!\[\]\(cat\.png\)[\s\S]*!\[\]\(dog\.png\)/);
  const waiting = page.getByRole("list", { name: "Images to post" });
  await expect(waiting.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Remove dog.png" }).click();
  await expect(note(page)).not.toHaveValue(/dog\.png/);
  await expect(waiting.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Pictured" })).toBeVisible();
  // The picture of the markdown note, and the image note of its own.
  await expect(page.locator(".md img")).toBeVisible();
  await loaded(page.locator(".md img")).toBeGreaterThan(0);
  await expect(page.locator("ol > li")).toHaveCount(2);
  await expect(page.locator("ol > li img")).toHaveCount(2);
  await page.getByRole("link", { name: "Open read-only view" }).click();
  await expect(page).toHaveURL(/\/r\/[^/]+$/);
  await expect(page.locator("ol > li img")).toHaveCount(2);
  await loaded(page.locator("ol > li img")).toBeGreaterThan(0);
});

test("more than 10 pictures: the first 10 wait in the box, and the box says why the rest do not", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await drop(page, ...Array.from({ length: 11 }, (_, i) => `p${i}.png`));
  await expect(page.getByRole("list", { name: "Images to post" }).getByRole("listitem")).toHaveCount(10);
  await expect(page.getByRole("alert").filter({ hasText: "A note can have at most 10 pictures." })).toBeVisible();
  await expect(note(page)).toHaveValue(/p9\.png/);
  await expect(note(page)).not.toHaveValue(/p10\.png/);
});

test("leaving the page without posting uploads nothing", async ({ page }) => {
  const name = feedName();
  const uploads: string[] = [];
  page.on("request", (r) => r.method() === "POST" && uploads.push(r.url()));
  await page.goto(`/${name}`);
  await drop(page, "cat.png");
  await expect(page.getByRole("list", { name: "Images to post" }).getByRole("listitem")).toHaveCount(1);
  await page.reload();
  await expect(note(page)).toHaveValue("");
  expect(uploads).toEqual([]);
  await expect(page.getByText("No notes yet")).toBeVisible();
});

test("only images, no text: posts the image notes and nothing else", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await choose(page, "Add image", PNG);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.locator("ol > li img")).toHaveCount(1);
  await expect(page.locator(".md")).toHaveCount(0);
  // The answer was the first picture's: ?posted= carries its note id, and that note is the picture.
  await expect(page).toHaveURL(/\?posted=\d{8}T\d{6}Z-[0-9a-f-]{36}$/);
  await page.goto(`/${name}/${new URL(page.url()).searchParams.get("posted")}`);
  await expect(page.locator("article img")).toBeVisible();
});

test("a new feed takes images and a password in its first post", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await note(page).fill("# Locked pictures");
  await choose(page, "Add image", PNG);
  await page.getByLabel("Password (optional, protects this feed)").fill("hunter22");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Locked pictures" })).toBeVisible();
  await expect(page.locator("ol > li")).toHaveCount(2); // the text and the picture
  await expect(page.locator(".md img")).toBeVisible();
  await page.context().clearCookies();
  await page.goto(`/${name}`);
  await expect(page.getByLabel("Feed password")).toBeVisible(); // protected: asks for it
  await expect(page.getByRole("link", { name: "Locked pictures" })).toHaveCount(0);
});

test("two pictures and a text that refers to one go in one request: the text shows both, each picture is a note", async ({ page }) => {
  const name = feedName();
  const posts: string[] = [];
  page.on("request", (r) => r.method() === "POST" && r.url().endsWith("/notes") && posts.push(r.headers()["content-type"] ?? ""));
  await page.goto(`/${name}`);
  await drop(page, "one.png", "two.png");
  await note(page).fill("# Two pictured\n\nsee ![](one.png) here");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Two pictured" })).toBeVisible();
  await expect(page.locator("ol > li")).toHaveCount(3); // the text, one.png and two.png
  await expect(page.locator(".md img")).toHaveCount(2); // one.png where the text refers to it, two.png appended
  await loaded(page.locator(".md img")).toBeGreaterThan(0);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatch(/^multipart\/form-data; boundary=/);
});

test("a picture the server refuses posts nothing: the box says which, and keeps the text and the pictures", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Before");
  await note(page).fill("# Half posted?");
  await drop(page, "good.png");
  await choose(page, "Add image", { name: "a.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "a.png: Only PNG, JPEG, GIF and WebP" })).toBeVisible();
  await expect(note(page)).toHaveValue(/Half posted\?[\s\S]*good\.png[\s\S]*a\.png/);
  await expect(page.getByRole("list", { name: "Images to post" }).getByRole("listitem")).toHaveCount(2);
  await page.reload();
  await expect(page.locator("ol > li")).toHaveCount(1); // only the note from before
  await expect(page.getByRole("link", { name: "Half posted?" })).toHaveCount(0);
});

test("a text file chosen as an image is refused when posting, and stays in the box", async ({ page }) => {
  await post(page, feedName(), "# Refusing");
  await choose(page, "Add image", { name: "a.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Only PNG, JPEG, GIF and WebP" })).toBeVisible();
  await expect(note(page)).toHaveValue("![](a.png)");
});

test("editing a note offers the same control, and saving posts the picture", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Editable");
  await page.getByRole("link", { name: "Editable" }).click();
  await page.getByText("Edit", { exact: true }).click();
  await choose(page, "Add image", PNG);
  await expect(note(page)).toHaveValue(/!\[\]\(pixel\.png\)/);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await loaded(page.locator(".md img")).toBeGreaterThan(0);
});

test("a note's text replaced by just a new picture's reference stays a text note, holding the picture", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Only words");
  await page.getByRole("link", { name: "Only words" }).click();
  await expect(page).toHaveURL(new RegExp(`/${name}/[^/?]+$`)); // the click navigates in the page: wait for the note's own address
  const url = page.url();
  await page.getByText("Edit", { exact: true }).click();
  await note(page).fill("");
  await choose(page, "Add image", PNG);
  await expect(note(page)).toHaveValue("![](pixel.png)");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await loaded(page.locator(".md img")).toBeGreaterThan(0);
  await page.goto(url); // the same note, read again: still a text to edit, its reference now the stored file
  await page.getByText("Edit", { exact: true }).click();
  await expect(note(page)).toHaveValue(/^!\[\]\(\d{8}T\d{6}Z-[0-9a-f-]{36}\.png\)$/);
  await page.goto(`/${name}`);
  await expect(page.locator("ol > li")).toHaveCount(2); // the text note and the picture
});

test("a picture the server refuses when saving: the editor says which, and the note and the feed stay as they were", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Unchanged");
  await page.getByRole("link", { name: "Unchanged" }).click();
  await expect(page).toHaveURL(new RegExp(`/${name}/[^/?]+$`)); // the click navigates in the page: wait for the note's own address
  const url = page.url();
  await page.getByText("Edit", { exact: true }).click();
  await choose(page, "Add image", { name: "a.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await expect(note(page)).toHaveValue(/!\[\]\(a\.png\)/);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "a.png: Only PNG, JPEG, GIF and WebP" })).toBeVisible();
  await page.goto(url);
  await page.getByText("Edit", { exact: true }).click();
  await expect(note(page)).toHaveValue("# Unchanged");
  await page.goto(`/${name}`);
  await expect(page.locator("ol > li")).toHaveCount(1);
});

test("a title that fails to save after a picture was added: saving again stores the picture once", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Retried");
  await page.getByRole("link", { name: "Retried" }).click();
  await page.getByText("Edit", { exact: true }).click();
  await page.getByLabel("Title (optional, otherwise taken from the text)").fill("New title");
  await choose(page, "Add image", PNG);
  let failed = false;
  await page.route("**/notes/*", (route) => {
    if (route.request().method() !== "PATCH" || failed) return route.continue();
    failed = true;
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "x", code: "x" }) });
  });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Something went wrong." })).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.goto(`/${name}`);
  await expect(page.getByRole("link", { name: "New title" })).toBeVisible();
  await expect(page.locator("ol > li")).toHaveCount(2); // the text note and one picture, not two
});

// A paste event as a browser makes it: a clipboard holding the fixture PNG, and `text` when given.
async function paste(page: Page, text?: string) {
  const png = readFileSync(PNG).toString("base64");
  await note(page).evaluate(
    (ta, { png, text }) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], "clip.png", { type: "image/png" }));
      if (text) data.setData("text/plain", text);
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    },
    { png, text },
  );
}

test("pasting an image adds it to the box", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await paste(page);
  await expect(note(page)).toHaveValue("![](clip.png)");
  await expect(page.getByRole("list", { name: "Images to post" }).getByRole("listitem")).toHaveCount(1);
});

test("pasting a clipboard that also holds text adds no image", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await paste(page, "copied cells");
  await expect(page.getByRole("list", { name: "Images to post" })).toHaveCount(0);
  await expect(note(page)).toHaveValue("");
});

test("a title image shows in the header and the read-only view, and can be removed", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Titled");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Typed, not saved"); // choosing an image keeps what is typed
  await choose(page, "Choose image", PNG);
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Typed, not saved");
  const header = page.locator("header img:not([src=\"/icon.svg\"])");
  await expect(header).toBeVisible();
  expect(await header.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Open read-only view" }).click();
  await expect(page).toHaveURL(/\/r\/[^/]+$/);
  await expect(page.locator("header img:not([src=\"/icon.svg\"])")).toBeVisible();
  await page.goto(`/${name}/settings`); // not goBack: where it lands depends on timing
  await page.getByRole("button", { name: "Remove image" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.locator("header img:not([src=\"/icon.svg\"])")).toHaveCount(0);
  await page.getByRole("link", { name: "Open read-only view" }).click();
  await expect(page).toHaveURL(/\/r\/[^/]+$/);
  await expect(page.locator("header img:not([src=\"/icon.svg\"])")).toHaveCount(0);
});

test("a title typed in the compose box is the note's title in the list", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await note(page).fill("# Derived heading\nbody");
  await page.getByLabel("Title (optional, otherwise taken from the text)").fill("Chosen title");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Chosen title" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Derived heading" })).toHaveCount(0);
});

test("the title of an image note can be set and changed on its page", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await choose(page, "Add image", PNG);
  await page.getByRole("button", { name: "Post note" }).click();
  await page.locator("ol > li a").first().click(); // the picture links to its page
  await expect(page.locator("article img")).toBeVisible();
  await page.getByText("Edit", { exact: true }).click();
  await expect(page.getByLabel("Note in markdown")).toHaveCount(0); // a picture has no text to edit
  await page.getByLabel("Title (optional)").fill("A pixel");
  await page.getByLabel("Alternative text (optional, for screen readers)").fill("one red pixel");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByRole("heading", { name: "A pixel" })).toBeVisible();
  await expect(page.locator("article img")).toHaveAttribute("alt", "one red pixel");
});

test("the title image can be picked from the feed's images, and goes when its note is deleted", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Has pictures");
  await choose(page, "Add image", PNG);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.locator("ol > li")).toHaveCount(2); // the picture is a note; its lone reference is no text note
  await expect(page.locator("ol > li img")).toHaveCount(1);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: /^Use .* as the title image$/ }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.locator("header img:not([src=\"/icon.svg\"])")).toBeVisible();
  await page.goto(`/${name}`);
  await page.locator("ol > li a").first().click();
  await page.getByText("Delete", { exact: true }).click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page).toHaveURL(new RegExp(`/${name}\\?deleted=`));
  await expect(page.locator("header img:not([src=\"/icon.svg\"])")).toHaveCount(0);
});

test("a title and tags typed with only pictures go on the pictures, accents included", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await choose(page, "Add image", PNG);
  await page.getByLabel("Title (optional, otherwise taken from the text)").fill("Café 日本語");
  await page.getByLabel("Tags (optional, separated by commas)").fill("pets, cats");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Café 日本語" }).first()).toBeVisible(); // the title, and the picture named by it
  await expect(page.getByRole("link", { name: "pets" })).toBeVisible();
  await expect(page.getByRole("link", { name: "cats" })).toBeVisible();
  await expect(page.locator("ol > li")).toHaveCount(1); // no text note
});
