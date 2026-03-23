import type { TestUser } from "../types/models";

interface Props {
  user: TestUser;
  compact?: boolean;
}

export default function TenantInfo({ user, compact }: Props) {
  if (compact) {
    return (
      <div className="tenant-info tenant-info--compact">
        <div className="tenant-info__marker" />
        <div>
          <span className="tenant-info__name">{user.tenant_name}</span>
          <span className="tenant-info__id">{user.tenant_id}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="tenant-info card" style={{ padding: "24px" }}>
      <div className="tenant-info__header">
        <div className="tenant-info__marker tenant-info__marker--lg" />
        <div>
          <div className="tenant-info__label">TENANT</div>
          <div className="tenant-info__name tenant-info__name--lg">
            {user.tenant_name}
          </div>
        </div>
      </div>
      <div className="tenant-info__details">
        <div className="tenant-info__detail">
          <span className="tenant-info__detail-label">ID</span>
          <span className="tenant-info__detail-value">{user.tenant_id}</span>
        </div>
        <div className="tenant-info__detail">
          <span className="tenant-info__detail-label">Admin</span>
          <span className="tenant-info__detail-value">{user.name}</span>
        </div>
        <div className="tenant-info__detail">
          <span className="tenant-info__detail-label">Email</span>
          <span className="tenant-info__detail-value">{user.email}</span>
        </div>
        <div className="tenant-info__detail">
          <span className="tenant-info__detail-label">Role</span>
          <span className="badge badge--base">{user.role}</span>
        </div>
      </div>
    </div>
  );
}
