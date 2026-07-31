F2 ① — GFM autolinks in two passes. Only the parse-time pass is real syntax;
the transform-time pass runs over already-decoded mdast text, so a URL the codec
escaped on the way out decoded back to a URL on the way in and got claimed as a
link. Dropping the transform-time pass is what stops the rewrite.

Real autolinks must still work:

<tonyg@lshift.net> is a CommonMark autolink. So are https://example.com and
www.example.com after whitespace, which GFM claims at parse time.

Character references must stay literal, NOT become links:

&lt;tonyg@lshift.net&gt; is a literal angle-bracketed address per CommonMark.

Escaped colons must stay text: https\://example.com is not a link.

Plain text that merely looks addressable stays plain: a@b, foo.bar, and
mailto\:someone@example.com.
