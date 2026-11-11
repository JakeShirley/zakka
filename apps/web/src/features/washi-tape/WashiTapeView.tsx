import { Panel, WorkspaceHeader } from "../../components/layout";
import { WashiTapeGallery } from "./WashiTapeGallery";

export function WashiTapeView() {
  return (
    <>
      <WorkspaceHeader title="Washi Tape" />
      <section className="workspace-grid washi-tape-page" aria-label="Washi tape library">
        <Panel title="Washi tape gallery">
          <WashiTapeGallery />
        </Panel>
      </section>
    </>
  );
}

export function WashiTapeIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3.2 7.4 15.6 3.6l.5 1.3-.9.6 1 .7-.4.8 1.1.5.3 1.2-12.4 3.8-.4-1.2.9-.6-1-.7.4-.8-1.1-.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.2"
        transform="translate(-0.6 3.4)"
      />
      <path
        d="m6.4 9.4 1.2-.4m2.3-.7 1.2-.4m2.3-.7 1.2-.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.2"
        transform="translate(-0.6 3.4)"
      />
    </svg>
  );
}
