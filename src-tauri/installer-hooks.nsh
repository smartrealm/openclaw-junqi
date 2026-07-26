; Keep the uninstaller's cleanup process outside the GUI lifecycle. The
; explicit mainBinaryName in tauri.conf.json makes the first path stable;
; the product-name path is retained for upgrades built before that setting.
!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists "$INSTDIR\junqi-desktop.exe" 0 junqi_cleanup_legacy_name
    StrCpy $0 -1
    ExecWait '"$INSTDIR\junqi-desktop.exe" --junqi-uninstall-cleanup' $0
    Goto junqi_cleanup_check
  junqi_cleanup_legacy_name:
  IfFileExists "$INSTDIR\JunQi Desktop.exe" 0 junqi_cleanup_missing
    StrCpy $0 -1
    ExecWait '"$INSTDIR\JunQi Desktop.exe" --junqi-uninstall-cleanup' $0
  junqi_cleanup_check:
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "JunQi cleanup failed (exit code $0). Uninstall was stopped so cleanup can be retried. Close Docker/OpenClaw processes, ensure Docker Desktop is running when Docker mode was selected, and try again."
      Abort
    ${EndIf}
    Goto junqi_cleanup_done
  junqi_cleanup_missing:
    MessageBox MB_OK|MB_ICONSTOP "JunQi cleanup could not start because the application executable is missing. Repair or reinstall JunQi Desktop, then retry uninstall."
    Abort
  junqi_cleanup_done:
!macroend
