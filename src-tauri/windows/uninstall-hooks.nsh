; Tauri injects this hook before its default NSIS pages are created. Keep the
; uninstaller executable on the same visual identity as the installed app.
!define MUI_UNICON "${__FILEDIR__}\..\icons\icon.ico"

LangString JunQiUninstallPrompt ${LANG_ENGLISH} "Thank you for using JunQi Desktop.$\r$\n$\r$\nParting is only a chance for a better reunion. We hope to see you again.$\r$\n$\r$\nUninstall JunQi Desktop now?"
LangString JunQiUninstallPrompt ${LANG_SIMPCHINESE} "感谢您曾与 JunQi 同行。$\r$\n$\r$\n离别是为了更好的相遇，期待下次再见。$\r$\n$\r$\n确定要卸载 JunQi Desktop 吗？"

LangString JunQiUninstallComplete ${LANG_ENGLISH} "JunQi Desktop has been uninstalled.$\r$\n$\r$\nThank you for your time. We will be here when you return."
LangString JunQiUninstallComplete ${LANG_SIMPCHINESE} "JunQi Desktop 已完成卸载。$\r$\n$\r$\n感谢您的使用，期待下一次相见。"

!macro NSIS_HOOK_PREUNINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "$(JunQiUninstallPrompt)" IDYES continue
  Abort
  continue:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  MessageBox MB_OK|MB_ICONINFORMATION "$(JunQiUninstallComplete)"
!macroend
