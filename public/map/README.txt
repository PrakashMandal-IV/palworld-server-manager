Live player map background
==========================

palworld-map.jpg is the current post-Feybreak Palworld world map (Palpagos +
Sakurajima + Feybreak), 1512x1512, North-up. Player dots from the REST API
(location_x / location_y) are plotted on it.

Calibration (components/MapPanel.jsx, the CAL constants) was solved from two live
reference points on this coordinate system:
  Hill of Beginnings (start teleporter)  location (-358796, 268134)
  Anubis desert patch                    location (-160446,  98612)
It's a single linear transform (uniform scale, North-up), so it covers the whole
map including Feybreak. If the game ships a new map image, re-solve CAL from two
fresh reference points and swap this file.

Source image downscaled from WisdomSky/palworld-feybreak-map (the full 16128px
render). Note: the in-game map art is Pocketpair's IP — only ship a map you have
the right to distribute.
