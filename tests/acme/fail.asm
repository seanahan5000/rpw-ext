

                bne +                   ; *** should fail to resolve with org set
+

                !h f0f 1f2
                !h 0x00
                !h $00
                !h SOME_SYMBOL
