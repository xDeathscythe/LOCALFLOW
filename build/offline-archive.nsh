; Loaded after the stock utility macros, before installApplicationFiles expands.
; Offline media must remain reusable; there is no downloaded updater cache.
!macroundef moveFile
!macro moveFile FROM TO
  !if "${FROM}" != "$packageFile"
    !error "Unexpected NSIS moveFile call: review offline archive handling"
  !endif
!macroend
