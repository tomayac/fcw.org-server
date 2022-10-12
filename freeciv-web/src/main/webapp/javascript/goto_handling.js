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
/* State machine vars: */
var goto_active = false;                  // state for selecting goto target for a unit: i.e., mouse position changes ask server for new path
var patrol_mode = false;                  // repeat goto_path forward then backward
var rally_active = false;                 // modifies goto_active to be setting a rally point
var old_rally_active = false;             // Transitional state var remembers rally_active in Go...And mode (rally_active pathing off while dialog is up)
const RALLY_PERSIST = 2;                  // value for rally_active indicating a persistent rally point will be set */
const RALLY_DEFAULT_UTYPE_ID = 22;        // Since utype_move_rate influences pathing, a "dumb default placeholder" utype for rally pathing. City production utype comes first, Armor comes next. This is a fall-thru only for city has no types in queue nor " Armor" in ruleset  
var rally_virtual_utype_id = RALLY_DEFAULT_UTYPE_ID; // Which utype gets use when requesting rally path; see line above.
var rally_city_id = null;                 // City being asked to set a rally point 
var delayed_goto_active = false;          // Modifies goto_active state to give a delayed goto command
var paradrop_active = false;
var airlift_active = false;
/* # of times to force request_goto_path on the same tile: performance hack to prevent constant requests on the same tile.
 * We used to constantly request_goto_path on the same tile because the first couple of times didn't give enough time to
 * properly construct a clean path: */
const FORCE_CHECKS_AGAIN = -4;
const LAST_FORCED_CHECK = -1;  // When FORCE_CHECKS_AGAIN++ arrives at this value, we stop requesting goto paths for the same tile
var prev_goto_tile;            // counter for above

/* States for Connect Orders (worker roads/irrigates along path) */
var connect_active = false;               // indicates that goto_active goto_path is for connect mode
var connect_extra = -1;                   // type of EXTRA to make, e.g., EXTRA_ROAD, EXTRA_IRRIGATION
var connect_activity = ACTIVITY_LAST;     // e.g., ACTIVITY_GEN_ROAD, ACTIVITY_IRRIGATE

/* State vars for blocking UI from goto updates when it's not a real GOTO */
var goto_path_skip_count = 0;             // prevents oversensitive changing of unit panel to goto panel, because even the slightest click trggers a millisecond of goto mode; this is a hack var that might not be needed anymore or could be cleaned up
const goto_path_trigger = 4;              // # of repeated calls to diplay goto_info_panel in unit info, before triggering to display it (fixes goto-drag being oversensitive in ms after the click)

/* State vars for GO...AND or lack of any "AND". Set when the goto is activated. */
var goto_last_order = -1;
var goto_last_action = -1;

/* Vars which store info about an active GOTO mode: */
var goto_dirs = [];                       // Keeps track of each tile on the map, if a goto path goes through it, which direction it goes.
var goto_request_map = {};                // Key is "unit.id,dest.x,dest.y". Caches packets for paths from server for this unit to dest so as mouse moves around we don't over-ping the server for the same paths repeatedly. If player clicks the dest while goto_active, it will also pull this map when generated the real goto order to fire off.
var goto_turns_request_map = {};          // Legacy relic appears to be residual var no longer used, slated for deletion ?
var current_goto_turns = 0;               // # of turns path has up to this point; from most recent goto_req packet, probably should be cleaned up with other vars named differently
var goto_way_points = {};                 // For multi-turn gotos, records which tiles a unit end its turn on, using tile index as key

/* In user-built paths, this stores the concatenation of decisions up to the point where user is still "indecisively" selecting the next segment */
var goto_segment = {           // If building a goto path segment, this stores the info we need 
  "unit_id": -1,
  "start_tile": -1,            // The tile_index of the START tile of the LAST (newly-being-selected-and-not-yet-concatenated) segment
  "moves_left_initially": -1,  // moves_left on the start tile of the new segment
  "fuel_left_initially": -1,   // fuel_left  "   "    "    "   "   "   "     "
  "saved_path": []             /* Contains all path info for any prior user-built pathing 
  * from punit.tile up to the start tile of a newly-being-selected path segment: i.e., this
  * is a concatenation of all previously built path segments into a single historical one
  * that leads right up to the beginning of the new one being made now. This array is info-rich
  * with member data from all goto_packets and contains:
  *     dest - last tile of saved path
  *     dir[] - directions from punit.tile to dest
  *     tile[] - tile indices of each tile from punit.tile to the one before 'dest'
  *     turn[] - when arriving at tile[x+1] using dir[x], turn[x] is how many turns used getting there 
  *     length - len of path in dirs
  *     movesleft - movefrags left as of arriving at 'dest'
  *     total_mc - total move cost in frags to arrive at 'dest'
  *     fuelleft - amount of fuel left as of arriving at 'dest'
  *     unit_id - punit.id
  */
};

/**************************************************************************
  Clear any existing goto path segments. Call if starting a new GOTO or
  clearing/aborting prior path segments of an existing path construction.
**************************************************************************/
function clear_goto_segment() {
  goto_segment = {           // if building a goto path segment, this stores the info we need
    "unit_id": -1,
    "start_tile": -1,            // the tile.index of the start tile of the last segment
    "moves_left_initially": -1,  // moves_left on the start tile of the last segment
    "fuel_left_initially": -1,   // fuel_left  "   "    "    "   "   "   "     "
    "saved_path": []             // path, in dirs, from punit.tile to the start tile of the last segment
  };
}
/**************************************************************************
 Removes goto lines and clears goto tiles.
**************************************************************************/
function clear_goto_tiles()
{
  /* old way, > 5x performance cost 
  if (renderer == RENDERER_2DCANVAS) {
    for (var x = 0; x < map['xsize']; x++) {
      for (var y = 0; y < map['ysize']; y++) {
        tiles[x + y * map['xsize']]['goto_dir'] = null;
      }
    }
  } */
  if (renderer == RENDERER_2DCANVAS) {
    const num_tiles = map['xsize'] * map['ysize'];
    goto_dirs = Array(num_tiles).fill(null);
  } else {
    if (scene != null && goto_lines != null) {
      for (var i = 0; i < goto_lines.length; i++) {
        scene.remove(goto_lines[i]);
      }
      goto_lines = [];
    }
  }
}
/**************************************************************************
 Whether any user-built path concatenation has been stashed as the
 base-path on which current goto path reqs are building.
**************************************************************************/
function is_goto_segment_active() {
  return (goto_segment.start_tile > -1);
}

/**************************************************************************
  If a new path-segment starting at tile_index is requested, we must first
  make sure that tile isn't in previous path, in order to prevent the
  same tile from appearing twice or more in the same goto_path. Although
  often it would work, we're conservatvely restricting it for sanity:
    (1) it's inefficient to revisit the same tile later in the path,
    (2) goto_dirs[tile.index] only stores one dir for a tile, not 2.
    (3) 'dest' in the key of goto_request_map could cause overwrite error
        if dest ends on a tile that has a previous goto_request_map, tho
        we could fix that (probably we already did).
**************************************************************************/
function is_tile_already_in_goto_segment(tile_index) {
  console.log("New segment request for tile %d:",tile_index);
  var debug_str = "Ask new seg @ tile "+tile_index+" || ";

  if (goto_segment['saved_path'] 
      && goto_segment['saved_path']['tile'] 
      && goto_segment['saved_path']['tile'].length) {

    for (i=0; i<goto_segment['saved_path']['tile'].length; i++) {
      debug_str += goto_segment['saved_path']['tile'][i] + ":" + dir_get_name(goto_segment['saved_path']['dir'][i]) +" "
      if (goto_segment['saved_path']['tile'][i] == tile_index) {
        console.log(debug_str);
        console.log("*** Error, segment start already in saved_path");
        return true;
      }
    }
    console.log(debug_str);
  }
  console.log(debug_str+" No existing saved_path.")
  return false;
}

/**************************************************************************
  Called when hitting tab during GOTO to freeze a waypoint and the path
  to that waypoint, as a BASE-PATH on which new goto path requestss will
  build AS IF the unit is already on that tile with the moves_left and
  fuel_left it will have when arriving there. i.e., save-path-up-to-here
  and let me select a path from there to add to it.
**************************************************************************/
function start_goto_path_segment()
{
  if (!goto_active || rally_active) return;

  var punit = current_focus[0];
  var ptile = canvas_pos_to_tile(mouse_x, mouse_y);

  // Grab a copy of the path that got us here to the tile we clicked TAB on:
  var prior_goto_packet;
  if (goto_request_map[punit.id + "," + ptile.x + "," + ptile.y]) {
    prior_goto_packet = goto_request_map[punit.id + "," + ptile.x + "," + ptile.y]; // REFERENCE not copy!
  }

  if (!prior_goto_packet || prior_goto_packet.length == 0) {
    console.log("Error, hit tab for a waypoint when there's no goto_request_map for punit to that tile.");
     return;
  } else console.log("Retrieved an existing path before new segment.")

  current_goto_turns = prior_goto_packet['turns'];

  // Stash path to this point, pushing it to any existing segment from earlier:
  if (goto_segment.saved_path.length) { // Append to prior path
    goto_segment.saved_path = merged_goto_packet(prior_goto_packet, punit); 
  } else { // Make a new path
    goto_segment.saved_path = JSON.parse(JSON.stringify(prior_goto_packet));
  }
  // Stash the starting tile for this new goto path segment!
  goto_segment.start_tile = ptile['index'];
  goto_segment["unit_id"] = punit['id'];
  // Stash moves and fuel to this point 
  goto_segment.moves_left_initially = prior_goto_packet['movesleft'];
  goto_segment.fuel_left_initially = prior_goto_packet['fuelleft'];
}

/**************************************************************************
  Merges new goto path packet to any existing segments or makes a new seg
  if first merge request. Wrapper for function below.
**************************************************************************/
function merged_goto_packet(new_packet, punit) {
  return merge_goto_path_segments(goto_segment.saved_path, new_packet, punit); 
}

/**************************************************************************
  Takes a new goto_packet and merges it to an old one to make a unified
  single path stored in a single goto_packet-compatible object
**************************************************************************/
function merge_goto_path_segments(old_packet, new_packet, punit)
{
  // Deep copy the old packet
  var result_packet = JSON.parse(JSON.stringify(old_packet));
  // Put the ending information into it:
  result_packet['dest'] = new_packet['dest'];
  result_packet['turns'] += new_packet['turns']; // since we started with the moves_left of old packet, ok iff that # is >=0 ?
  result_packet['total_mc'] += new_packet['total_mc'];
  result_packet['movesleft'] = new_packet['movesleft'];
  result_packet['length'] += new_packet['length'];
  result_packet['fuelleft'] = new_packet['fuelleft'];
  if (result_packet['dir'] && result_packet['dir'].length
      && new_packet['dir'] && new_packet['dir'].length) {
    result_packet['dir'] = result_packet['dir'].concat(new_packet['dir']); // makes a new copy
  }
  if (new_packet['turn'] && new_packet['turn'].length) {
    for (var i=0; i<new_packet['turn'].length; i++) {
      result_packet['turn'].push(new_packet['turn'][i] + old_packet['turns']) 
    }
  }
  // Log every tile in the path.
  if (!punit) punit = current_focus[0];
  result_packet['tile'] = [];
  result_packet['tile'].push(punit['tile']);

  var debug_str = "merge: ";

  for (i=1; i<result_packet['dir'].length; i++) {
    /*console.log("mapstep(t:%d,d:%d)",result_packet['tile'][i-1],
                                     result_packet['dir'][i-1])*/

  debug_str += "t:" + i + "."  + result_packet['tile'][i-1]
            + dir_get_name(result_packet['dir'][i-1]) + ", ";
  result_packet['tile'].push(mapstep(index_to_tile(result_packet['tile'][i-1]),
                                       result_packet['dir'][i-1])['index']);
  }
  debug_str += "t:" + i + "."  + result_packet['tile'][i-1]
            + dir_get_name(result_packet['dir'][i-1]) + "."; 

  console.log(debug_str);

  return result_packet;
}

/****************************************************************************
  Show the GOTO path in the unit_goto_path packet. Ultimately this means
  putting goto_dirs[tindex] = dir, after we figure out all our other logic.
****************************************************************************/
function update_goto_path(goto_packet)
{
  var punit = units[goto_packet['unit_id']];
  var join_to_existing_segment = is_goto_segment_active();

  if (!join_to_existing_segment) {
    goto_way_points = {};       // Clear old waypoints IFF it's a new path only
  } else goto_request_map = {}; // Insurance: stashing multiple grm's in join-mode could make circularity/overwrite issues.

  var goto_path_packet = (join_to_existing_segment && punit) 
                       ? merged_goto_packet(goto_packet, punit) 
                       : goto_packet;

  /* No unit_id means rally_active or path has no length. This block is
     required to show the goto info when path_len is 0 on the start tile,
     so player can see the original moves/fuel left @ start: */
  if (goto_packet['unit_id'] === undefined) {
    if (goto_active && !rally_active) {
      if (current_focus.length > 0) {
        focus_unit_id = current_focus[0]['id'];
        if (focus_unit_id) {
          update_goto_path_panel(0,0,0,units[focus_unit_id].movesleft);
        }
      }
    }
    return;
  }

  var ptile;
  var movesleft = 0;
  var ptype;

/* SET THE START AND DEST TILE: */
  /* GOTO PATH FOR A UNIT: */
  if (punit) {
    ptype = unit_type(punit);
    movesleft = punit.movesleft;
    /* This would be if we only want to draw last segment, not full path:
    ptile = join_to_existing_segment ? index_to_tile(goto_segment.start_tile) : index_to_tile(punit['tile']); */
    ptile = index_to_tile(punit['tile']);
  } 
  /* otherwise, RALLY PATHING: */
  else if (goto_packet['unit_id'] == 0) { // flag for rally path
    var pcity = cities[rally_city_id];
    if (pcity == null) { // if no unit nor city then abort
      return; 
    }
    // If we got here we have a city and are doing a rally path
    ptile = city_tile(pcity);
    ptype = get_next_unittype_city_has_queued(pcity);
    if (!ptype) {
      movesleft = 2 * SINGLE_MOVE; // rallies with an unknown unittype move_rate default to a path made for move_rate 2
    } else {
      movesleft = ptype.move_rate;
    }
  }
  if (ptile == null) return;
  var goaltile = index_to_tile(goto_packet['dest']);
/* </end SET THE START AND DEST TILE> */
  var refuel = 0;

  // Don't bother checking goto for same tile unit is on
  if (ptile==goaltile) {
    // Just change the unit goto info for the pathing and return
    if (!rally_active) update_goto_path_panel(0,0,0,punit.movesleft);
    return;
  }
  if (renderer == RENDERER_2DCANVAS) {
    // First turn boundary waypoint is your own tile if you have no moves left
    goto_way_points[ptile.index] = movesleft ? 0 : SOURCE_WAYPOINT;

    var turn;
    var old_turn = goto_path_packet['turn'][0];
    var old_tile=null;
    var upcoming = false; // the way we draw goto lines or the way the server marks turn-changes, idk, but we have to advance it by one.
    for (var i = 0; i < goto_path_packet['dir'].length; i++) {
      if (ptile == null) break;
      var dir = goto_path_packet['dir'][i];

      //-------------------------------------------------
      turn = goto_path_packet['turn'][i];
      if (upcoming) {
        upcoming = false;
        goto_way_points[ptile.index] = SOURCE_WAYPOINT;
        if (old_tile) goto_way_points[old_tile.index] = DEST_WAYPOINT; // prevent overwrite
      } else if (i==goto_path_packet['dir'].length -1) { // very last turn boundary has no tile after so we prematurely compute it
        if (turn && turn-old_turn>0) {
          goto_way_points[ptile.index] = DEST_WAYPOINT;
        }
      } else if (i!=0) { // no turn boundary in all cases except first tile when you have no moves left
        goto_way_points[ptile.index] = 0;
      } 

      if (turn && turn-old_turn>0) {
        upcoming = true;
      }
      //---------------------------------------------------
      if (dir == -1) { /* Assume that this means refuel. */
        refuel++;
        continue;
      }
      goto_dirs[ptile.index] = dir;
      old_tile = ptile;
      ptile = mapstep(ptile, dir);
      old_turn = turn;
    }
  } else {
    webgl_render_goto_line(ptile, goto_packet['dir']);
  }

  goto_request_map[goto_packet['unit_id'] + "," + goaltile['x'] + "," + goaltile['y']] = goto_packet
  current_goto_turns = goto_packet['turns'];

  goto_turns_request_map[goto_packet['unit_id'] + "," + goaltile['x'] + "," + goaltile['y']]
	  = current_goto_turns;

  if (current_goto_turns !== "undefined" && punit) {
    let path_length = goto_packet['length'];
    // Fuel units inject extra non-path 'refuel data' in the goto_packet: +++
    if (refuel) path_length -= refuel;  // remove "refuel path steps" from path_length
  
    //let turns = Math.ceil(goto_packet['total_mc']/unit_type(punit)['move_rate'])-1;  << former client_side calc assumed full moves left (which we could correct if we wanted) and that the unit had no move bonus (which we can't correct for paths of 2 turns or more because only the server knows move bonuses!)
    let turns = current_goto_turns;
    if (turns<0) turns = 0;
    let movecost = goto_packet['total_mc'];
    //let remaining = parseInt(punit.movesleft - movecost);     THIS WORKS but let's try the server for getting info on multi-turn paths?
    let remaining = goto_packet['movesleft'];
    update_goto_path_panel(movecost,path_length,turns,remaining);
  }
  update_mouse_cursor();
}
function update_goto_path_panel(goto_move_cost, path_length, turns, remaining)
{
  /* Prevent oversensitive replacing of unit stats panel when we aren't in goto
     mode; caused by every click potentially being the start of a goto drag. */ 
  if (!goto_active) return;
  
  if (enable_goto_drag && path_length==0) {
    goto_path_skip_count++;
    if (goto_path_skip_count>goto_path_trigger) goto_path_skip_count=0;
    else return;
  }

  $("#active_unit_info").html("<span style='color:#9d9;font-size:90%'><b>"+move_points_text(goto_move_cost, false, true)+"</b></span> <span style='color:#ddd;font-size:90%'>move"+(parseInt(goto_move_cost/SINGLE_MOVE)>1 ? "s" : "")+"</span><br>"
  +( (turns>0) ? ("<span style='color:#"+(turns<1?"fd5":"f76")+";font-size:90%'><b>"+turns+"</b></span> <span style='color:#ddd;font-size:90%'> turn"+(turns>=2?"s":"")+"</span>"):"<span style='color:#bbb;font-size:90%'>in range</span>")
  +"<span style='font-size:90%;margin-left:auto;float:right;margin-right:20px;color:#7af'><span style='color:#eee'>t</span><b>"+path_length+"</b></span> <span style='color:#ddd;font-size:90%'></span><br>"
  +"<span style='font-size:90%;color:#"+(remaining>=0&&turns<1?"d7f":"f55")+"'><b>"+(remaining>=0?move_points_text(remaining, false, true):"&#8211")+"</b></span> <span style='color:#ddd;font-size:90%'> left"+"</span><br>"
  );
}

/****************************************************************************
  Show the GOTO path for middle clicked units
****************************************************************************/
function show_goto_path(goto_packet)
{
  // separate function to potentially handle cases differently
  update_goto_path(goto_packet);
}

/****************************************************************************
  When goto_active or rally_active, we periodically check mouse position
  to see if we should query the server for an updated goto path.
****************************************************************************/
function check_request_goto_path()
{
  var ptile;
  const do_new_check = (prev_mouse_x != mouse_x || prev_mouse_y != mouse_y || prev_goto_tile<=LAST_FORCED_CHECK);
  var do_goto_check = goto_active && current_focus.length > 0 && do_new_check;
  var do_rally_check = !do_goto_check && rally_active && do_new_check;

  if (do_goto_check || do_rally_check) {
    ptile = (renderer == RENDERER_2DCANVAS) ? canvas_pos_to_tile(mouse_x, mouse_y)
                                            : webgl_canvas_pos_to_tile(mouse_x, mouse_y);
    if (ptile != null) {
      if (ptile['tile'] != prev_goto_tile) {
        clear_goto_tiles();
        /* Send request for path to server. */
        if (do_rally_check) {
          request_rally_path(rally_city_id, ptile['x'], ptile['y']);
        } else { // normal goto
          for (var i = 0; i < current_focus.length; i++) {
            request_goto_path(current_focus[i]['id'], ptile['x'], ptile['y'])              
          }
        }
      }
      // We don't want to constantly request the same tile if it hasn't changed, but we used to do that because sometimes
      // the first request_goto_path+clear_goto_tiles didn't have time(?) to clean old paths and construct a new path properly:
      if (prev_goto_tile <= LAST_FORCED_CHECK) {
        prev_goto_tile ++;
        if (prev_goto_tile > LAST_FORCED_CHECK) {
          if (ptile) prev_goto_tile = ptile['tile']; // Flag to not make continuous server requests for the same tile.
        }
      } // FLAG to force request_goto_path more times to clean path redraw glitch.  FORCE_CHECKS_AGAIN can be tuned to -x which forces...
      else prev_goto_tile = FORCE_CHECKS_AGAIN; // ... request_goto_path x more times before blocking requests on the same tile.
    }
  }

  prev_mouse_x = mouse_x;
  prev_mouse_y = mouse_y;
}
