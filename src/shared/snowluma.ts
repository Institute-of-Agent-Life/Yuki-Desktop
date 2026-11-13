export const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

/**
 * Enables SnowLuma in a Yuki deployment directory with the backend's own script, which writes
 * `.env` (`yuki setup snowluma`) and recreates the Bot with SnowLuma. Shown to the operator for a
 * server reached only by URL; an SSH-managed server runs the same line. The local deployment runs
 * the script's two Compose steps itself (`LocalBot.enableSnowLuma`), since Windows has no sh.
 */
export const snowLumaCommand = (image: string) => `sh deploy/snowluma.sh ${quote(image.trim())}`
/** The same line on an SSH-managed server: in its deployment directory, as the deployment's owner. */
export const snowLumaOnServer = (directory: string, image: string, sudo: string) =>
  `cd ${quote(directory)} && ${sudo}${snowLumaCommand(image)}`
