// The S3-compatible stand-in the "s3" project's server (port 3103) keeps its images in. It runs in the test runner's process for the
// whole run; the settings that point at it are in playwright.config.ts.
import { startFakeS3 } from "../backend/storage/images/fake-s3";

export default async function setup() {
  const s3 = await startFakeS3("e2e-access", ["e2e-images"], 3199);
  return () => s3.close();
}
