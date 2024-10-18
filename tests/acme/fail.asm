

                bne +                   ; *** should fail to resolve with org set
+

                !text "\x1F"            ; ERROR: unknown character escape
                !text "\z"              ; ERROR: unknown character escape

                !h f0f 1f2
                !h 0x00
                !h $00
                !h SOME_SYMBOL
