F7 — a GFM row cannot span physical lines, so a hard break inside a table cell
takes `<br>`. Reading is uniform: `<br>`, `<br/>`, and `<br />` in any position
become a hard break. Writing stays native wherever a physical newline is safe.

| Header | Second |
| - | - |
| line one<br>line two | plain |
| a<br/>b | c<br />d |

Ordinary prose keeps the native backslash form and must NOT gain HTML tags:

first line\
second line

The one required exception — a hard break at the very END of a block also takes
`<br>`, because `a\` at the end of a block is a literal backslash rather than a
break in CommonMark, so the native form re-parsed as text and doubled its escape
every save:

paragraph ending in a break<br>

A genuine end-of-block literal backslash must stay text, not become a break:

this ends with a real backslash \\

Marks must survive on both sides of a break:

**bold before**\
**bold after**
