Live player map background
==========================

palworld-map.jpg is the current post-Feybreak Palworld world map (Palpagos +
Sakurajima + Feybreak), 2048x2048, North-up, icon-free. Player dots from the REST
API (location_x / location_y) are plotted on it.

Calibration (components/MapPanel.jsx, the CAL constants) was solved from two live
reference points on this coordinate system:
  Hill of Beginnings (start teleporter)  location (-358796, 268134)
  Anubis desert patch                    location (-160446,  98612)
It's a single linear transform (uniform scale, North-up), so it covers the whole
map including Feybreak. If the game ships a new map image, re-solve CAL from two
fresh reference points and swap this file.

Source: base map-tiles from palworld.th.gl (max zoom 4, 16x16 x 512px = 8192px
stitched, no marker icons), then registered into this file's original framing so
the calibration above stays valid. The reframe was a similarity transform solved
by ORB feature matching against the previous WisdomSky-derived image: uniform
scale 1.015, no rotation (North-up), ~82px (of 1512) vertical shift. Because the
framing is preserved, CAL and calibration.json did NOT need to change.
Note: the in-game map art is Pocketpair's IP — only ship a map you have the
right to distribute.
