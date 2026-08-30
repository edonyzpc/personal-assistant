export const FTS_IOS_RUNTIME_FAMILY = "ios-wkwebview";
export const FTS_IOS_PLATFORM_CLASS = "ios-wkwebview-candidate";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/u;

export function shellVersionFromIosUserAgent(userAgent) {
  if (typeof userAgent !== "string") return null;
  return userAgent.match(
    /(?:^|[\s;(])obsidian\/([0-9A-Za-z][0-9A-Za-z._+-]*)/iu,
  )?.[1] ?? null;
}

function hasIndependentPlainObsidianToken(userAgent) {
  return /(?:^|[\s;(])obsidian(?:$|[\s;)])/iu.test(userAgent);
}

function hasCapacitorLocalhostOrigin(locationHref) {
  return typeof locationHref === "string"
    && /^capacitor:\/\/localhost(?:[/:?#]|$)/iu.test(locationHref);
}

export function iosOperatorObservationBlockers(observation, generatedAtValue = null) {
  const blockers = [];
  if (observation?.schemaVersion !== 1
    || observation?.observationType !== "pa.fts-ios-runtime-operator-observation") {
    blockers.push("ios_operator_observation_schema_invalid");
  }
  if (observation?.realDeviceObserved !== true
    || observation?.iphoneMirroringObserved !== true
    || observation?.safariWebInspectorObserved !== true
    || observation?.inspectedApplicationId !== "md.obsidian"
    || observation?.runtimeFamily !== FTS_IOS_RUNTIME_FAMILY) {
    blockers.push("ios_operator_observation_missing");
  }
  if (!Number.isFinite(Date.parse(observation?.observedAt ?? ""))) {
    blockers.push("ios_operator_observation_time_invalid");
  } else {
    const generatedAt = Date.parse(generatedAtValue ?? "");
    const observedAt = Date.parse(observation.observedAt);
    if (!Number.isFinite(generatedAt) || Math.abs(observedAt - generatedAt) > 5 * 60_000) {
      blockers.push("ios_operator_observation_stale");
    }
  }
  if (observation?.hardwareAttestationClaimed !== false) {
    blockers.push("hardware_attestation_claim_invalid");
  }
  return [...new Set(blockers)];
}

export function iosRuntimeIdentityBlockers(evidence) {
  const blockers = [];
  const browser = evidence?.browserIdentity ?? {};
  const runtime = evidence?.runtimeCanary?.runtime ?? {};
  const appIdentity = evidence?.appIdentity ?? {};
  const pluginIdentity = evidence?.pluginIdentity ?? {};
  const loadedBuild = pluginIdentity?.loadedBuild ?? {};
  const userAgent = typeof browser.userAgent === "string" ? browser.userAgent : "";
  const platform = typeof browser.platform === "string" ? browser.platform : "";
  const locationHref = typeof browser.locationHref === "string" ? browser.locationHref : "";
  const maxTouchPoints = Number(browser.maxTouchPoints);
  const hasIphoneOrIpodUa = /(?:iPhone|iPod)/u.test(userAgent);
  const hasIpadUa = /iPad/u.test(userAgent);
  const hasMacintoshMobileUa = /Macintosh/u.test(userAgent) && /Mobile/u.test(userAgent);
  const hasIosUa = hasIphoneOrIpodUa || hasIpadUa || hasMacintoshMobileUa;
  const processVersions = runtime?.versions;
  const electronPresent = /Electron/iu.test(userAgent)
    || (processVersions && typeof processVersions.electron === "string")
    || runtime?.host === "electron-renderer"
    || runtime?.host === "electron-node"
    || runtime?.processType === "renderer";
  const platformMatches = hasIphoneOrIpodUa
    ? /^(?:iPhone|iPod)/u.test(platform)
    : hasIpadUa
      ? /^(?:iPad|MacIntel)$/u.test(platform)
      : hasMacintoshMobileUa && platform === "MacIntel";
  const touchIdentityMatches = Number.isInteger(maxTouchPoints) && maxTouchPoints >= 2;
  const observedShellVersion = shellVersionFromIosUserAgent(userAgent);
  const hasVersionedShellIdentity = observedShellVersion !== null
    && SAFE_VERSION_PATTERN.test(appIdentity.shellVersion ?? "")
    && appIdentity.shellVersionSource === "navigator.userAgent:obsidian/x"
    && appIdentity.shellVersion === observedShellVersion;
  // Current iOS Obsidian emits a standalone, unversioned `obsidian` token.
  // Accept null shell evidence only when the surrounding WKWebView identity is
  // independently strong; a substring or generic mobile Safari UA is not enough.
  const hasUnversionedIosShellIdentity = observedShellVersion === null
    && appIdentity.shellVersion === null
    && appIdentity.shellVersionSource === null
    && hasIndependentPlainObsidianToken(userAgent)
    && hasIosUa
    && /AppleWebKit\//u.test(userAgent)
    && !electronPresent
    && platformMatches
    && touchIdentityMatches
    && browser.hasDocument === true
    && hasCapacitorLocalhostOrigin(locationHref);

  if (!hasIosUa) blockers.push("ios_user_agent_missing");
  if (!/AppleWebKit\//u.test(userAgent)) blockers.push("apple_webkit_missing");
  if (electronPresent) blockers.push("electron_runtime_present");
  if (!platformMatches) blockers.push("ios_platform_mismatch");
  if (!touchIdentityMatches) blockers.push("touch_identity_missing");
  if (browser.hasDocument !== true) blockers.push("browser_document_missing");
  if (evidence?.runtimeFamily !== FTS_IOS_RUNTIME_FAMILY
    || evidence?.platformClass !== FTS_IOS_PLATFORM_CLASS) {
    blockers.push("ios_runtime_classification_missing");
  }
  if (!SAFE_VERSION_PATTERN.test(appIdentity.loadedAppVersion ?? "")
    || appIdentity.loadedAppVersionSource !== "obsidian.apiVersion"
    || appIdentity.identitySource !== "plugin.getObsidianRuntimeIdentity"
    || (!hasVersionedShellIdentity && !hasUnversionedIosShellIdentity)
    || runtime.obsidianAppVersion !== appIdentity.loadedAppVersion
    || runtime.obsidianVersionSource !== appIdentity.loadedAppVersionSource) {
    blockers.push("formal_app_identity_missing");
  }
  if (pluginIdentity.id !== "personal-assistant"
    || !SAFE_VERSION_PATTERN.test(pluginIdentity.version ?? "")) {
    blockers.push("plugin_identity_missing");
  }
  if (loadedBuild.schemaVersion !== 1
    || loadedBuild.identitySource !== "plugin-onload-cached-main-js"
    || loadedBuild.pluginId !== pluginIdentity.id
    || loadedBuild.pluginVersion !== pluginIdentity.version
    || !SHA256_PATTERN.test(loadedBuild.loadedPluginArtifactSha256 ?? "")
    || typeof loadedBuild.lexicalProfileRuntimeFingerprint !== "string"
    || loadedBuild.lexicalProfileRuntimeFingerprint.length < 8) {
    blockers.push("loaded_plugin_build_identity_missing");
  }
  if (SHA256_PATTERN.test(loadedBuild.loadedPluginArtifactSha256 ?? "")
    && SHA256_PATTERN.test(evidence?.artifacts?.plugin?.sha256 ?? "")
    && loadedBuild.loadedPluginArtifactSha256 !== evidence.artifacts.plugin.sha256) {
    blockers.push("loaded_plugin_artifact_mismatch");
  }
  if (SHA256_PATTERN.test(evidence?.sourceIdentity?.currentPluginArtifactSha256 ?? "")
    && SHA256_PATTERN.test(evidence?.artifacts?.plugin?.sha256 ?? "")
    && evidence.sourceIdentity.currentPluginArtifactSha256
      !== evidence.artifacts.plugin.sha256) {
    blockers.push("device_plugin_artifact_mismatch");
  }
  if (typeof loadedBuild.lexicalProfileRuntimeFingerprint === "string"
    && typeof evidence?.profileCanary?.artifact?.runtimeFingerprint === "string"
    && loadedBuild.lexicalProfileRuntimeFingerprint
      !== evidence.profileCanary.artifact.runtimeFingerprint) {
    blockers.push("loaded_profile_runtime_mismatch");
  }
  if (!SHA256_PATTERN.test(evidence?.deviceIdentitySha256 ?? "")) {
    blockers.push("device_identity_missing");
  }
  blockers.push(...iosOperatorObservationBlockers(
    evidence?.operatorObservation,
    evidence?.generatedAt,
  ));
  return [...new Set(blockers)];
}
