import { OrgList } from "./OrgList";

export function OrgManager() {
  return (
    <section className="module">
      <div className="module-header">
        <h2>Org 管理</h2>
      </div>
      <OrgList />
    </section>
  );
}
