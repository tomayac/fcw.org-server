/**********************************************************************
    Freeciv-web - the web version of Freeciv. http://play.freeciv.org/
    Copyright (C) 2009-2015  The Freeciv-web project

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.

***********************************************************************/

var OVERVIEW_TILE_SIZE = 1;
var overviewTimerId = -1;
var min_overview_width = 200;
var max_overview_width = 300;
var max_overview_height = 300;
var overview_map_height = 140;

var OVERVIEW_REFRESH;

var palette = [];
var palette_color_offset = 0;
var palette_terrain_offset = 0;

var overview_active = false;

var COLOR_OVERVIEW_UNKNOWN = 0; /* Black */
var COLOR_OVERVIEW_MY_CITY = 1; /* white */
var COLOR_OVERVIEW_ALLIED_CITY = 2;
var COLOR_OVERVIEW_ENEMY_CITY = 3; /* cyan */
var COLOR_OVERVIEW_MY_UNIT = 4; /* yellow */
var COLOR_OVERVIEW_ALLIED_UNIT = 5;
var COLOR_OVERVIEW_ENEMY_UNIT = 6; /* red */
var COLOR_OVERVIEW_VIEWRECT = 7; /* white */
var COLOR_OVERVIEW_GENERIC = 8;  /* dull terrain, to show diplrelations better */

var overview_hash = -1;
var overview_current_state = null;


/****************************************************************************
  Initilaize the overview map.
****************************************************************************/
function init_overview()
{
  while (min_overview_width > OVERVIEW_TILE_SIZE * map['xsize']) {
    OVERVIEW_TILE_SIZE++;
  }

  overview_active = true;

  $("#game_overview_panel").attr("title", "");
  $("#game_overview_panel").dialog({
			bgiframe: true,
			modal: false,
			appendTo: '#tabs-map',
			resizable: false,
			closeOnEscape: false,
			dialogClass: 'overview_dialog no-close',
			autoResize:true,
			width: "auto",
			close: function(event, ui) { overview_active = false;}
		}).dialogExtend({
                  "minimizable" : true,
                  "maximizable" : true,
                  "closable" : false,
                  "minimize" : function(evt, dlg){
                      overview_current_state = $("#game_overview_panel").dialogExtend("state");
                      $(".overview_dialog").css({"height":"8","width":65});
                      unobstruct_minimized_dialog_container(); // don't let wide container block clicks
                    },
                  "maximize" : function(evt, dlg){
                      overview_current_state = $("#game_overview_panel").dialogExtend("state");
                      $(".overview_dialog").css({"height":"auto","width":$(window).width()-4});

                      $('#overview_map').width($("#game_overview_panel").width() - 20);
                      $('#overview_map').height($("#game_overview_panel").height() - 20);
                    },
                  "restore" : function(evt, dlg){
                      overview_current_state = $("#game_overview_panel").dialogExtend("state");
                      var new_width = OVERVIEW_TILE_SIZE * map['xsize'];
                      if (new_width > max_overview_width) new_width = max_overview_width;
                      var new_height = OVERVIEW_TILE_SIZE * map['ysize'];
                      if (new_height > max_overview_height) new_height = max_overview_height;
                      $(".overview_dialog").css({"height":(new_height),"width":(new_width)});

                      $('#overview_map').width(new_width);
                      $('#overview_map').height(new_height);
                      $(".overview_dialog").position({my: 'left bottom', at: 'left bottom', of: window, within: $("#tabs-map")});
                    },
                  "icons" : {
                    "minimize" : "ui-icon-circle-minus",
                    "maximize" : "ui-icon-circle-plus",
                    "restore" : "ui-icon-bullet"
                  }});
  if (overview_current_state == "minimized") $("#game_overview_panel").dialogExtend("minimize");

  $("#game_overview_panel").parent().css("overflow", "hidden");


  palette = generate_palette();

  redraw_overview();

  var new_width = OVERVIEW_TILE_SIZE * map['xsize'];
  if (new_width > max_overview_width) new_width = max_overview_width;
  var new_height = OVERVIEW_TILE_SIZE * map['ysize'];
  if (new_height > max_overview_height) new_height = max_overview_height;
  $('#overview_map').width(new_width);
  $('#overview_map').height(new_height);
  $(".overview_dialog").position({my: 'left bottom', at: 'left bottom', of: window, within: $("#tabs-map")});

  $('#overview_map').on('dragstart', function(event) { event.preventDefault(); });
  // globe icon symbol
  /* old fa-icon, deprecated
  $("#game_overview_panel").parent().children().not("#game_overview_panel").children().get(0).innerHTML 
    = "<div style='font-size:97%; vertical-align:top; font-family:Arial; margin-bottom: 1px;'><i style='color #5df !important' class='fa fa-globe' aria-hidden='true'></i></div>";
  */
  $("#game_overview_panel").parent().children().not("#game_overview_panel").children().get(0).innerHTML 
  = "<div margin-bottom: 1px;'><img src='/images/e/earth.png' height='16px'></div>";

  // adjust minimize/maximize icons
  $("#game_overview_panel").siblings().children().next().css("margin-top", "-7px");
  
  // This affects the titlebar and map itself. Map is already square. Titlebar will lose rounding
  // on lower corners but not top corners which are applied to its parent.  This removes annoying
  // illusion that stone panel under the overviewmap is overwriting or invading the titlebar.
  $(".overview_dialog").children().css("border-radius", "0px");
}

/****************************************************************************
  Redraw the overview map.
****************************************************************************/
function redraw_overview()
{
  if (mapview_slide['active'] || C_S_RUNNING > client_state()
      || map['xsize'] == null || map['ysize'] == null
      || $("#overview_map").length == 0) return;

  var hash = generate_overview_hash(map['xsize'], map['ysize'])

  if (hash != overview_hash) {
    bmp_lib.render('overview_img',
                    generate_overview_grid(map['xsize'], map['ysize']),
                    palette);
    overview_hash = hash;
    render_viewrect();
  }
}

/****************************************************************************
  Forces a redraw the overview map.
****************************************************************************/
function force_redraw_overview() 
{
  var hash = generate_overview_hash(map['xsize'], map['ysize'])
  bmp_lib.render('overview_img', generate_overview_grid(map['xsize'], map['ysize']),
                  palette);
  overview_hash = hash;
  render_viewrect();
}


/****************************************************************************
  Creates a grid representing the image for the overview map.
****************************************************************************/
function generate_overview_grid(cols, rows) {
  // Loop variables
  var row;

  if (cols & 1) cols -= 1;  //Bugfix, the overview map doesn't support map size which is odd.
  if (rows & 1) rows -= 1;

  // The grid of points that make up the image.
  var grid = Array(rows*OVERVIEW_TILE_SIZE);
  for (row = 0; row < rows * OVERVIEW_TILE_SIZE; row++) {
    grid[row] = Array(cols * OVERVIEW_TILE_SIZE);
  }

  for (var x = 0; x < rows ; x++) {
    for (var y = 0; y < cols; y++) {
      var ocolor = overview_tile_color(y, x);
      render_multipixel(grid, x, y, ocolor);
    }
  }

  return grid;
}

/****************************************************************************
  Creates a hash of the current overview map.
****************************************************************************/
function generate_overview_hash(cols, rows) {

  var hash = 0;

  for (var x = 0; x < rows ; x++) {
    for (var y = 0; y < cols; y++) {
      hash += overview_tile_color(y, x);
    }
  }

  var r = base_canvas_to_map_pos(0, 0);
  if (r != null) {
    hash += r['map_x'];
    hash += r['map_y'];
  }

  return hash;
}

/****************************************************************************
  ...
****************************************************************************/
function render_viewrect()
{
  if (C_S_RUNNING != client_state() && C_S_OVER != client_state()) return;

  var path = [];

    var point = base_canvas_to_map_pos(0, 0);
    path.push([point.map_x, point.map_y]);
    point = base_canvas_to_map_pos(mapview['width'], 0);
    path.push([point.map_x, point.map_y]);
    point = base_canvas_to_map_pos(mapview['width'], mapview['height']);
    path.push([point.map_x, point.map_y]);
    point = base_canvas_to_map_pos(0, mapview['height']);
    path.push([point.map_x, point.map_y]);

  var viewrect_canvas = document.getElementById('overview_viewrect');
  if (viewrect_canvas == null) return;

  var map_w = $('#overview_map').width();
  var map_h = $('#overview_map').height();
  viewrect_canvas.width = map_w;
  viewrect_canvas.height = map_h;

  var viewrect_ctx = viewrect_canvas.getContext("2d");

  viewrect_ctx.clearRect(0, 0, map_w, map_h);
  viewrect_ctx.strokeStyle = 'rgb(200,200,255)';
  viewrect_ctx.lineWidth = map.xsize / map_w;
  viewrect_ctx.scale(map_w/map.xsize, map_h/map.ysize);

  viewrect_ctx.beginPath();
  add_closed_path(viewrect_ctx, path);

  if (topo_has_flag(TF_WRAPX)) {
    viewrect_ctx.save();
    viewrect_ctx.translate(map.xsize, 0);
    add_closed_path(viewrect_ctx, path);
    viewrect_ctx.translate(-2 * map.xsize, 0);
    add_closed_path(viewrect_ctx, path);
    viewrect_ctx.restore();
  }

  viewrect_ctx.stroke();
}

function add_closed_path(ctx, path)
{
  ctx.moveTo(path[0][0], path[0][1]);
  for (var i = 1; i < path.length; i++) {
    ctx.lineTo(path[i][0], path[i][1]);
  }
  ctx.lineTo(path[0][0], path[0][1]);
}

/****************************************************************************
  ...
****************************************************************************/
function render_multipixel(grid, x, y, ocolor)
{
  if (x >= 0 && y >= 0 && x < map['ysize'] && y < map['xsize']) {
    for (var px = 0; px < OVERVIEW_TILE_SIZE; px++) {
      for (var py = 0; py < OVERVIEW_TILE_SIZE; py++) {
          grid[(OVERVIEW_TILE_SIZE*x)+px][(OVERVIEW_TILE_SIZE*y)+py] = ocolor;
      }
    }
  }
}

/****************************************************************************
  Creates the palette for the overview map.
****************************************************************************/
function generate_palette() {
  var palette = [];
  palette[COLOR_OVERVIEW_UNKNOWN] = [0,0,0];
  palette[COLOR_OVERVIEW_MY_CITY] = [255,255,255];
  palette[COLOR_OVERVIEW_ALLIED_CITY] = [0,255,255];
  palette[COLOR_OVERVIEW_ENEMY_CITY] = [0,255,255];
  palette[COLOR_OVERVIEW_MY_UNIT] = [255,255,0];
  palette[COLOR_OVERVIEW_ALLIED_UNIT] = [255,0,0];
  palette[COLOR_OVERVIEW_ENEMY_UNIT] = [255,0,0];
  palette[COLOR_OVERVIEW_VIEWRECT] = [200,200,255];
  palette[COLOR_OVERVIEW_GENERIC]  = [71,89,57];
  palette_terrain_offset = palette.length;
  for (var terrain_id in terrains) {
    var terrain = terrains[terrain_id];
    palette.push([terrain['color_red'], terrain['color_green'], terrain['color_blue']]);
  }

  palette_color_offset = palette.length;
  var player_count = Object.keys(players).length;

  for (var player_id in players) {
    var pplayer = players[player_id];
    if (pplayer['nation'] == -1) {
      palette[palette_color_offset+(player_id % player_count)] = [0,0,0];
    } else {
      var pcolor = null;
      const observer = client_is_observer();
      switch (minimap_color) {  // 'minimap_color' is user toggleable state for nation color display
        case 0:  // diplomatic relations mode
            if (observer || client.conn.playing == null) pcolor = [138,138,142];            // observer  = med grey = no relations to anyone
            else if (!pplayer['is_alive']) pcolor = [48, 32, 32];                           // dead      = dark grey, reddish
            else if (player_id == client.conn.playing['playerno']) pcolor = [55,128,255];   // self      = light blue
            else if (!observer && diplstates[player_id] != null) {
              if (diplstates[player_id] == DS_WAR) pcolor = [192,32,32];                    // war       = red
              else if (diplstates[player_id] == DS_ALLIANCE) pcolor = [0,32,240];           // ally      = med blue
              else if (diplstates[player_id] == DS_PEACE) pcolor = [0,202,32];              // peace     = green
              else if (diplstates[player_id] == DS_ARMISTICE) pcolor = [105,197,32];        // armistice = green hinting olive
              else if (diplstates[player_id] == DS_CEASEFIRE){pcolor = [160,192,32];        // ceasefire = ochre
                if (pplayer.diplstates[client.conn.playing.playerno].turns_left 
                   && pplayer.diplstates[client.conn.playing.playerno].turns_left <=3)
                   pcolor = [222,192,32];                                                   // expiring cease-fire = yellow/orange (concerned citizens!)
              }
              else pcolor = [138,138,142]                                                   // no contact = grey
            }
            break;
        case 2:  pcolor = nations[pplayer['nation']]['color2']; break;  // show secondary national colors mode
        case 3:  pcolor = nations[pplayer['nation']]['color3']; break;  // show tertiary national colors mode
        default: pcolor = nations[pplayer['nation']]['color'];          // default: just show primary national color
      }
      if (pcolor != null) {
        palette[palette_color_offset+(player_id % player_count)] = color_rgb_to_list(pcolor);
      } else {
        palette[palette_color_offset+(player_id % player_count)] = [0,0,0];
      }
    }
  }
  return palette;
}

/****************************************************************************
  Returns the color of the tile at the given map position.
****************************************************************************/
function overview_tile_color(map_x, map_y)
{
  var ptile = map_pos_to_tile(map_x, map_y);

  var pcity = tile_city(ptile);

  if (pcity != null) {
    if (client.conn.playing == null) {
      return COLOR_OVERVIEW_ENEMY_CITY;
    } else if (city_owner_player_id(pcity) == client.conn.playing['id']) {
      return COLOR_OVERVIEW_MY_CITY;
    } else {
      return COLOR_OVERVIEW_ENEMY_CITY;
    }
  }

  var punit = find_visible_unit(ptile);
  if (punit != null) {
    if (client.conn.playing == null) {
      return COLOR_OVERVIEW_ENEMY_UNIT;
    } else if (punit['owner'] == client.conn.playing['id']) {
      return COLOR_OVERVIEW_MY_UNIT;
    } else if (punit['owner'] != null && punit['owner'] != 255) {
      return palette_color_offset + punit['owner'];
    } else {
      return COLOR_OVERVIEW_ENEMY_UNIT;
    }
  }

  if (tile_get_known(ptile) != TILE_UNKNOWN) {
    if (ptile['owner'] != null && ptile['owner'] != 255) {
      return palette_color_offset + ptile['owner'];
    } else {
      if (minimap_color == 0 
        // diplomatic relations mode: dull terrain color to just see relations
          && !is_ocean_tile(ptile)) return COLOR_OVERVIEW_GENERIC; 

      return palette_terrain_offset + tile_terrain(ptile)['id'];
    }
  }

  return COLOR_OVERVIEW_UNKNOWN;
}


/****************************************************************************
  ...
****************************************************************************/
function overview_clicked (x, y)
{
  var width = $("#overview_map").width();
  var height = $("#overview_map").height();

  var x1 = Math.floor((x * map['xsize']) / width);
  var y1 = Math.floor((y * map['ysize']) / height);

  var ptile = map_pos_to_tile(x1, y1);
  if (ptile != null) {
    //reposition events save the position to return to with shift-spacebar
    center_tile_mapcanvas(ptile);
  }

  redraw_overview();
}
