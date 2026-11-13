export const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

/**
 * Enables SnowLuma in a Yuki deployment directory with the backend's own script, which writes
 * `.env` (`yuki setup snowluma`) and recreates the Bot with SnowLuma. Shown to the operator for a
 * server reached only by URL; an SSH-managed server and the local deployment run the same script.
 */
export const snowLumaCommand = (image: string) => `sh deploy/snowluma.sh ${quote(image.trim())}`
