const { notarize } = require('@electron/notarize');

exports.default = async function notarizeMac(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appBundleId = context.packager.appInfo.appId;
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn('[notarize] Skipping notarization; APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID are required.');
    return;
  }

  await notarize({
    appBundleId,
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });
};
