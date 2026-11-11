import type { WashiTapeDesign } from "@zakka/editor-core";
import { useState } from "react";

import { AppModal } from "../../components/layout";
import { WashiTapeGallery } from "./WashiTapeGallery";

export function WashiTapeGalleryModal({
  onAddWashiTape,
  onClose,
}: {
  onAddWashiTape: (design: WashiTapeDesign) => void;
  onClose: () => void;
}) {
  const [isPhotoPickerOpen, setIsPhotoPickerOpen] = useState(false);

  return (
    <AppModal title="Add washi tape" closeDisabled={isPhotoPickerOpen} onClose={onClose}>
      <WashiTapeGallery
        onAddWashiTape={(design) => {
          onAddWashiTape(design);
          onClose();
        }}
        onPhotoPickerOpenChange={setIsPhotoPickerOpen}
      />
    </AppModal>
  );
}
