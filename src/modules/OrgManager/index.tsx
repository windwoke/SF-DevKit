import { OrgList } from "./OrgList";

export function OrgManager() {
  return (
    <section className="module module-org">
      <div className="module-header module-header--compact">
        <h2>Org 管理</h2>
      </div>
      <OrgList />
    </section>
  );
}
