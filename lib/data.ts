// DATA_DIR is only known at runtime.
export const dataDir = () => process.env.DATA_DIR || "/data";
