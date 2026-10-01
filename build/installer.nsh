; nsis-web supports an external, checksummed archive larger than NSIS's embedded
; payload limit. Ship BOTH files together. Abort before any download is possible.
!macro customInit
  !ifdef APP_PACKAGE_URL
    ${StdUtils.GetParameter} $0 "package-file" ""
    ${if} $0 != ""
      MessageBox MB_ICONSTOP "This offline installer uses only its accompanying verified data archive."
      Abort
    ${endif}
    IfFileExists "$EXEDIR\${APP_64_NAME}" +3 0
      MessageBox MB_ICONSTOP "Keep the LocalFlow installer and its .7z data file in the same folder. The complete offline package is required."
      Abort
    ${StdUtils.HashFile} $0 "SHA2-512" "$EXEDIR\${APP_64_NAME}"
    ${if} $0 != "${APP_64_HASH}"
      MessageBox MB_ICONSTOP "The LocalFlow data file failed verification. Obtain the complete offline package again."
      Abort
    ${endif}
  !endif
!macroend

!macro customInstall
  DetailPrint "Preparing local speech recognition and window transparency..."
  nsExec::ExecToLog '"$INSTDIR\resources\runtime\python\python.exe" -I -B "$INSTDIR\resources\scripts\setup-windows.py"'
  Pop $0
  ${if} $0 != 0
    MessageBox MB_ICONSTOP "LocalFlow setup could not prepare local speech recognition or window compatibility. See $INSTDIR\setup.log, then run setup again." /SD IDOK
    SetErrorLevel 1
    Abort
  ${endif}
!macroend
