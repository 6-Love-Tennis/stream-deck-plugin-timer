/**
 * AppleScriptObjC that drives EventKit directly (no `tell application "Calendar"`,
 * which is slow and triggers a separate automation prompt). It reads all events in a
 * time window from every calendar the user has in macOS Calendar.app — including any
 * Google account synced natively — and prints a JSON object to stdout.
 *
 * Output shapes:
 *   {"status":"no-access"}                       when Calendar Full Access isn't granted
 *   {"status":"ok","events":[ {RawEvent}, ... ]} otherwise (events may be empty)
 *
 * RawEvent = { title, start, end, allday, status, declined, location, notes, url }
 *   - start/end are ISO-8601 UTC strings (parseable by `new Date()`).
 *   - status is EKEventStatus (3 = canceled).
 *   - declined is true when the current user's attendee status is "declined".
 *
 * The window length (seconds) is passed as the first `run` argument, so we don't
 * interpolate untrusted values into the script text.
 */
export const EVENTKIT_SCRIPT = `use AppleScript version "2.4"
use scripting additions
use framework "Foundation"
use framework "EventKit"

on run argv
	set ca to current application

	set windowSeconds to 86400
	try
		if (count of argv) > 0 then set windowSeconds to (item 1 of argv) as integer
	end try

	set store to ca's EKEventStore's alloc()'s init()
	set authStatus to (ca's EKEventStore's authorizationStatusForEntityType:0) as integer

	-- 3 = authorized / full access. Anything else means we can't read events.
	if authStatus is not 3 then
		-- Best effort: trigger the system permission prompt on first run. The request
		-- is asynchronous and this process exits before it resolves, so we still report
		-- no-access for now; the next poll (after the user grants access) will succeed.
		try
			store's requestFullAccessToEventsWithCompletion:(missing value)
		on error
			try
				store's requestAccessToEntityType:0 completion:(missing value)
			end try
		end try
		return "{\\"status\\":\\"no-access\\"}"
	end if

	set nowDate to ca's NSDate's |date|()
	set endDate to nowDate's dateByAddingTimeInterval:windowSeconds
	set pred to store's predicateForEventsWithStartDate:nowDate endDate:endDate calendars:(missing value)
	set theEvents to (store's eventsMatchingPredicate:pred)

	set isoFmt to ca's NSISO8601DateFormatter's alloc()'s init()
	set outArr to ca's NSMutableArray's array()

	set n to (theEvents's |count|()) as integer
	repeat with i from 1 to n
		set ev to (theEvents's objectAtIndex:(i - 1))
		set d to ca's NSMutableDictionary's dictionary()

		set t to ev's title()
		if t is missing value then set t to ""
		(d's setObject:(t as text) forKey:"title")

		(d's setObject:(isoFmt's stringFromDate:(ev's startDate())) forKey:"start")
		(d's setObject:(isoFmt's stringFromDate:(ev's endDate())) forKey:"end")
		(d's setObject:(ca's NSNumber's numberWithBool:(ev's isAllDay())) forKey:"allday")
		(d's setObject:(ca's NSNumber's numberWithInteger:(ev's status())) forKey:"status")

		set loc to ev's location()
		if loc is missing value then set loc to ""
		(d's setObject:(loc as text) forKey:"location")

		set nts to ev's notes()
		if nts is missing value then set nts to ""
		(d's setObject:(nts as text) forKey:"notes")

		set u to ev's |URL|()
		if u is missing value then
			(d's setObject:"" forKey:"url")
		else
			(d's setObject:(u's absoluteString()) forKey:"url")
		end if

		set theCal to ev's calendar()
		if theCal is missing value then
			(d's setObject:"" forKey:"calendarId")
		else
			(d's setObject:(theCal's calendarIdentifier() as text) forKey:"calendarId")
		end if

		-- Determine whether the current user declined this invite.
		set declined to false
		set atts to ev's attendees()
		if atts is not missing value then
			set an to (atts's |count|()) as integer
			repeat with j from 1 to an
				set att to (atts's objectAtIndex:(j - 1))
				try
					if (att's isCurrentUser()) then
						if ((att's participantStatus()) as integer) is 3 then set declined to true
					end if
				end try
			end repeat
		end if
		(d's setObject:(ca's NSNumber's numberWithBool:declined) forKey:"declined")

		(outArr's addObject:d)
	end repeat

	set root to ca's NSMutableDictionary's dictionary()
	(root's setObject:"ok" forKey:"status")
	(root's setObject:outArr forKey:"events")

	set jsonData to ca's NSJSONSerialization's dataWithJSONObject:root options:0 |error|:(missing value)
	set jsonStr to (ca's NSString's alloc()'s initWithData:jsonData encoding:(ca's NSUTF8StringEncoding))
	return jsonStr as text
end run`;

/**
 * Lists every calendar the user has, so the Property Inspector can offer a picker.
 *
 * Output shapes:
 *   {"status":"no-access"}
 *   {"status":"ok","calendars":[ { id, title, account } ]}
 */
export const LIST_CALENDARS_SCRIPT = `use AppleScript version "2.4"
use scripting additions
use framework "Foundation"
use framework "EventKit"

on run
	set ca to current application
	set store to ca's EKEventStore's alloc()'s init()
	set authStatus to (ca's EKEventStore's authorizationStatusForEntityType:0) as integer

	if authStatus is not 3 then
		return "{\\"status\\":\\"no-access\\"}"
	end if

	set cals to store's calendarsForEntityType:0
	set outArr to ca's NSMutableArray's array()

	set n to (cals's |count|()) as integer
	repeat with i from 1 to n
		set c to (cals's objectAtIndex:(i - 1))
		set d to ca's NSMutableDictionary's dictionary()

		(d's setObject:(c's calendarIdentifier() as text) forKey:"id")

		set t to c's title()
		if t is missing value then set t to ""
		(d's setObject:(t as text) forKey:"title")

		set acct to ""
		set src to c's source()
		if src is not missing value then
			set srcTitle to src's title()
			if srcTitle is not missing value then set acct to (srcTitle as text)
		end if
		(d's setObject:acct forKey:"account")

		(outArr's addObject:d)
	end repeat

	set root to ca's NSMutableDictionary's dictionary()
	(root's setObject:"ok" forKey:"status")
	(root's setObject:outArr forKey:"calendars")

	set jsonData to ca's NSJSONSerialization's dataWithJSONObject:root options:0 |error|:(missing value)
	set jsonStr to (ca's NSString's alloc()'s initWithData:jsonData encoding:(ca's NSUTF8StringEncoding))
	return jsonStr as text
end run`;
