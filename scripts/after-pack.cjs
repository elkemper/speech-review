const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

/**
 * Ad-hoc sign the finished .app so macOS on Apple Silicon accepts the bundle.
 * This is not notarization: the first launch may still require
 * `xattr -cr "/Applications/Speech Review.app"`.
 */
exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = join(context.appOutDir, `${appName}.app`)

  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
      stdio: 'inherit'
    })
    console.log(`Ad-hoc signed: ${appPath}`)
  } catch (error) {
    console.warn(`Ad-hoc signing failed: ${error.message}`)
  }
}
