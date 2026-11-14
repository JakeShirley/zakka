import { Panel, WorkspaceHeader } from "../../components/layout";
import { BackgroundGallery } from "./BackgroundGallery";

export function BackgroundsView() {
  return (
    <>
      <WorkspaceHeader title="Backgrounds" />
      <section className="workspace-grid backgrounds-page" aria-label="Background library">
        <Panel title="Background library">
          <BackgroundGallery />
        </Panel>
      </section>
    </>
  );
}
