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
  await expect(page.locator("ol > li img")).toHaveCount(2);
  await loaded(page.locator("ol > li img")).toBeGreaterThan(0);
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
  await note(page).fill("");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.locator("ol > li img")).toHaveCount(1);
  await expect(page.locator(".md")).toHaveCount(0);
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

test("a refused upload keeps the box as it was, and posting again continues", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await note(page).fill("# Two pictures");
  await drop(page, "one.png", "two.png");
  let calls = 0;
  await page.route("**/images", async (route) => {
    calls++;
    if (calls === 2) return route.fulfill({ status: 415, contentType: "application/json", body: JSON.stringify({ error: "x", code: "unsupported_type" }) });
    return route.continue();
  });
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Only PNG, JPEG, GIF and WebP" })).toBeVisible();
  await expect(note(page)).toHaveValue(/Two pictures[\s\S]*one\.png[\s\S]*two\.png/);
  await expect(page.getByRole("list", { name: "Images to post" }).getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Post note" }).click(); // the first is not sent again
  await expect(page.getByRole("link", { name: "Two pictures" })).toBeVisible();
  await expect(page.locator("ol > li")).toHaveCount(3); // the text, and one.png and two.png once each
  expect(calls).toBe(3); // one.png, two.png (refused), two.png again
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
  await expect(page.locator("header img:not([src=\"/icon.svg\"])")).toBeVisible();
  await page.goBack();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Remove image" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.locator("header img:not([src=\"/icon.svg\"])")).toHaveCount(0);
  await page.getByRole("link", { name: "Open read-only view" }).click();
  await expect(page.locator("header img:not([src=\"/icon.svg\"])")).toHaveCount(0);
});
