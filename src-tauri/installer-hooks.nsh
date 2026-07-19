; Keep the uninstaller's cleanup process outside the GUI lifecycle. The
; explicit mainBinaryName in tauri.conf.json makes the first path stable;
; the product-name path is retained for upgrades built before that setting.
!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists "$INSTDIR\junqi-desktop.exe" 0 junqi_cleanup_legacy_name
    ExecWait '"$INSTDIR\junqi-desktop.exe" --junqi-uninstall-cleanup' $0
    Goto junqi_cleanup_done
  junqi_cleanup_legacy_name:
  IfFileExists "$INSTDIR\JunQi Desktop.exe" 0 junqi_cleanup_done
    ExecWait '"$INSTDIR\JunQi Desktop.exe" --junqi-uninstall-cleanup' $0
  junqi_cleanup_done:
!macroend
