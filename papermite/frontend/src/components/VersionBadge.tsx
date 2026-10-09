import { RELEASE_LABEL } from "../version";
import "./VersionBadge.css";

/** Small "v" in the corner of the login card; hover or focus shows the
 * release label (e.g. "papermite v0.9.0"). The parent needs the
 * `version-badge-host` class so the badge anchors to its corner. */
export default function VersionBadge() {
  return (
    <span className="version-badge" tabIndex={0} aria-label={RELEASE_LABEL} data-label={RELEASE_LABEL}>
      v
    </span>
  );
}
