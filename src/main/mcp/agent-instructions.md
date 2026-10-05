# worfy canvas

This Session runs inside worfy, an app that shows the Project on a canvas of Nodes.

## Cards

A Card is a small app on the canvas: one self-contained HTML file with inline or local JS and CSS.

- Create one with `create_card`. It returns the Card's folder; Cards live in `{{cardsDir}}/<id>/`.
- Write `index.html` (and, if needed, local css/js/images next to it) with Write or Edit.
- No Node, no build step, no generator scripts: the browser runs the files as they are.
- Network: https only.
- Card API (`window.worfy`): not available yet (worfy-mvp ticket 26).

## Canvas

Change the canvas only with the `worfy-canvas` tools, never by editing files:
`list_nodes`, `create_card`, `create_note`, `update_node`, `move_node`, `resize_node`,
`hide_node`, `link_card`. Nodes cannot be deleted; locked Nodes cannot be hidden.
