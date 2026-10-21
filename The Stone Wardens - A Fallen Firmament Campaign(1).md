Stone warden site.

The goal is to create a github repo that hosts a website that completes the following tasks in the context of traditional 5e dungeons and dragons: 

* Render a detailed, interactive map (not a combat map, something closer to Wonderdraft) where people who join can add pinpoints with titles and descriptions which can get permanently sent to the repo and updated.   
  * Keep this map blank for now, with a placeholder map. Do not upload existing dnd location to this map as it will be a custom dnd location  
  * Add location types when adding new locations/pinpoints  
    * These can be things such as: Danger markers, cities, towns, villages, temples etc. It should also allow custom items.  
* Host character sheets following formats inspired by online character sheet structures like: [https\://github.com/PartiallyAPotato/DnD-stuff/blob/main/Player%20Template](https://github.com/PartiallyAPotato/DnD-stuff/blob/main/Player%20Template)  
  * These sheets should allow the player (at any level) to add abilities/leveling stats, weapons, etc. Go through dnd5e to find all classes, species, and abilities to allow players to pre-load their character sheet at any level holding menus where they can select their preferences for abilities etc. All cells and stats should be editable in a separate menu.  
  * Weapons/inventory menu should draw weapons (with appropriate stats drawn from regular (traditional dnd5e). A new character sheet should be blank with these but players should be able to add to their character. The repo should be pre-loaded with every single weapon choice with the ability to easily add custom weapons to the repo using the website’s interface.   
  * When characters level up, new menus/slots can open based on their class and proper dnd leveling rules. However, in an advanced editing menu, players should be able to add special abilities. Also allow the ability to add custom abilities.  
  * Character sheets should be able to be created in a separate menu where new sheets are displayed by name.  
* A journal which can link to different areas of the site, specific map locations, and spots in a character sheet of a specific character etc. This is where the players of a party can aggregate their notes. Make this resemble the note formatting of an obsidian vault, using the same formatting rules too. These notes should be able to have sub folders called “Chapters” which can be organized to look like it is part of a book. 

The site, in order to initially access, must have a password which is hidden/encrypted in the repo in which only editing the repo can view.   
Anything custom added should also update a repo library where people should be able to access them even if they didn’t create it in their own character sheet. Ideally, active sessions should auto save, and before closing the tab, the repo should remind the user to save their work if it wasn’t saved. Any custom item, weapon, or location should be added to the repo once committed. Character sheets should automatically update if a user checks or changes some aspect.   
Interface the site like tabs from a collapsible side menu where the map is as large as possible when displayed. Character sheets should first display in grid view showing all the character names as the most essential stats which then can be expanded. The journal should look like an open book with the chapter page looking like a table of contents with hyperlinks to different tabs (the journal should have quick navigation as well).  
Links in any section of custom weapons or the map should be hyperlinked by default.

Resources to use:  
D\&D information:

* D\&D wiki  
* D\&D 5e rules

Style:

* D\&D wiki  
* Taste skill (download this for claude)  
* medieval but still easily readable and usable. 

Ask clarifying questions as needed. Commit and push changes as you go. Use parallel agents if needed.