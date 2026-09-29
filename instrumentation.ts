export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.NOTEFEED_TOKEN) {
    console.error("NOTEFEED_TOKEN is required. Set it to a long random secret.");
    process.exit(1);
  }
}
