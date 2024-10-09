


; TODO: errors on labels without colons when labels_without_colons not set
                .feature labels_without_colons-
no_colon
                .feature labels_without_colons+

; TODO: errors in strings with escapes when string_escapes not set
                .feature string_escapes-
                .asciiz "X\\X\"X\'X\rX\nX\tX\x1F"
                .feature string_escapes+

                .linecont
