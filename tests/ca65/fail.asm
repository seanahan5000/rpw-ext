


; TODO: errors on labels without colons when labels_without_colons not set
                .feature labels_without_colons-
no_colon                                ; ERROR: missing colon
                .feature labels_without_colons+

; TODO: errors in strings with escapes when string_escapes not set
                .feature string_escapes-
                .asciiz "X\\X\"X\'X\rX\nX\tX\x1F"
                .feature string_escapes+

                .linecont               ; ERROR: missing +

.import TKN_FLIGHT_CR:direct
.import TKN_FLIGHT_CR:absolute          ; ERROR: inconsistent import types for same symbol

LABEL           .byte LABEL, \
                    2,LABEL, 4          ; ERROR: (correct locations in multi-line statement)
