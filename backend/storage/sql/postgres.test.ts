// The contract suite against a real PostgreSQL. Set NOTEFEED_TEST_POSTGRES_URL to a throwaway database, e.g.
//   docker run -d --rm --name nf-pg -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:17-alpine
//   NOTEFEED_TEST_POSTGRES_URL=postgres://postgres:pw@localhost:55432/postgres npx vitest run backend/storage/sql/postgres.test.ts
// The tests use their own schema (nf_test) and drop it before each test; nothing else in the database is touched.
import { afterEach, describe, expect, test } from "vitest";
import { describeStorage } from "../contract";
import { createS3ImageStore } from "../images/s3";
import { connect } from "./connect";
import { createSqlStorage, type Images, type SqlStorage } from ".";

const base = process.env.NOTEFEED_TEST_POSTGRES_URL ?? "";
const supported = Number(process.versions.node.split(".")[0]) >= 22; // kysely needs Node 22
if (!base) console.info("NOTEFEED_TEST_POSTGRES_URL not set: skipping the PostgreSQL contract run");

// Every connection of a test works in the nf_test schema.
const url = () => `${base}${base.includes("?") ? "&" : "?"}options=${encodeURIComponent("-c search_path=nf_test")}`;

async function resetSchema() {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: base });
  await client.connect();
  await client.query("drop schema if exists nf_test cascade");
  await client.query("create schema nf_test");
  await client.end();
}

const open: SqlStorage[] = [];
const fresh = (images?: Images) => {
  const s = createSqlStorage(() => connect("postgres", url()), "postgres", images);
  open.push(s);
  return s;
};
afterEach(async () => {
  for (const s of open.splice(0)) await s.close();
});

describe.skipIf(!base || !supported)("postgres", () => {
  describeStorage("postgres", async () => {
    await resetSchema();
    return { storage: fresh(), cleanup: async () => {} };
  });

  // The hosted service's shape: rows in PostgreSQL, image bytes in an S3-compatible store. Needs NOTEFEED_TEST_S3_ENDPOINT and its
  // keys as well (see images/s3.test.ts); the bucket is made here if it is not there.
  const s3 = process.env.NOTEFEED_TEST_S3_ENDPOINT ?? "";
  describe.skipIf(!s3)("with images in an S3-compatible store", () => {
    const o = {
      endpoint: s3,
      bucket: process.env.NOTEFEED_TEST_S3_BUCKET || "notefeed-test",
      region: process.env.NOTEFEED_TEST_S3_REGION || "us-east-1",
      accessKey: process.env.NOTEFEED_TEST_S3_ACCESS_KEY ?? "",
      secretKey: process.env.NOTEFEED_TEST_S3_SECRET_KEY ?? "",
    };
    describeStorage("postgres with images in S3", async () => {
      await resetSchema();
      const { AwsClient } = await import("aws4fetch");
      const made = await new AwsClient({ accessKeyId: o.accessKey, secretAccessKey: o.secretKey, service: "s3", region: o.region }).fetch(`${o.endpoint.replace(/\/+$/, "")}/${o.bucket}`, { method: "PUT" });
      if (!made.ok && made.status !== 409) throw new Error(`could not make the test bucket (${made.status})`);
      return { storage: fresh({ store: createS3ImageStore(o), external: (ext) => ext === "png" }), cleanup: async () => {} };
    });
  });

  test("two starts at the same time migrate once", async () => {
    await resetSchema();
    const [a, b] = [fresh(), fresh()];
    await Promise.all([a.feedCount(), b.feedCount()]);
    const { Client } = await import("pg");
    const client = new Client({ connectionString: base });
    await client.connect();
    const r = await client.query("select count(*)::int as n from nf_test.kysely_migration");
    await client.end();
    expect(r.rows[0].n).toBe(2);
  });

  test("an unreachable database says NOTEFEED_DATABASE_URL and not the address", async () => {
    const s = createSqlStorage(() => connect("postgres", "postgres://nobody:hunter2@127.0.0.1:1/none"), "postgres");
    open.push(s);
    const err = (await s.feedCount().catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/NOTEFEED_DATABASE_URL/);
    expect(err.message).not.toMatch(/hunter2|127\.0\.0\.1/);
    expect(err.cause).toBeUndefined(); // the driver's error would carry the address
  });
});
