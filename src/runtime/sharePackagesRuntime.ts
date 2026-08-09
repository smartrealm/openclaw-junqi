import {
  exportSharePackage,
  importSharePackage,
  inspectSharePackage,
  previewSharePackageImport,
  scanSharePackageSource,
} from '@/api/tauri-commands';

export const sharePackagesRuntime = {
  scan: scanSharePackageSource,
  export: exportSharePackage,
  inspect: inspectSharePackage,
  previewImport: previewSharePackageImport,
  import: importSharePackage,
};
