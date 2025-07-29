                .asciiz "\x0"           ; ERROR: two digits required



; TODO: errors on labels without colons when labels_without_colons not set
                .feature labels_without_colons-
no_colon                                ; ERROR: missing colon
                .feature labels_without_colons+

                .asciiz "\0"            ; ERROR: not supported
                .asciiz "\z"            ; ERROR: not supported
                .asciiz "\x"            ; ERROR: digits required
                .asciiz "\x0"           ; ERROR: two digits required
                .asciiz "\xZ0"          ; ERROR: two hex digits required

; TODO: errors in strings with escapes when string_escapes not set
                .feature string_escapes-
                .asciiz "X\\X\"X\'X\rX\nX\tX\x1F"
                .feature string_escapes+

                .linecont               ; ERROR: missing +

.import TKN_FLIGHT_CR:direct
.import TKN_FLIGHT_CR:absolute          ; ERROR: inconsistent import types for same symbol

LABEL           .byte LABEL, \
                    2,LABEL, 4          ; ERROR: (correct locations in multi-line statement)

                lda #-1                 ; negative values not allowed

test = test+1                           ; ERROR: circular symbol reference
               bne test

                lda zpageVar            ; WARNING: forward declared zpage
zpageVar        =   0
