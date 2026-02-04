"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Calendar, dateFnsLocalizer, View } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import "react-big-calendar/lib/css/react-big-calendar.css";

const locales = {
  "en-US": require("date-fns/locale/en-US"),
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: "call" | "first_session" | "session" | "reminder";
  resource?: {
    parent_name?: string;
    player_names?: string[];
    location?: string;
    status?: string;
    reminder_type?: string;
    notes?: string;
    originalStart?: Date;
    originalEnd?: Date;
  };
}

interface DashboardData {
  upcomingCalls: Array<{
    id: number;
    name: string;
    call_date_time: string | null;
    phone?: string;
  }>;
  upcomingFirstSessions: Array<{
    id: number;
    parent_name: string;
    player_names?: string[];
    session_date: string;
    location?: string;
    status?: string;
  }>;
  upcomingSessions: Array<{
    id: number;
    parent_name: string;
    player_names?: string[];
    session_date: string;
    location?: string;
    status?: string;
  }>;
  upcomingReminders: Array<{
    id: number;
    parent_name: string;
    reminder_type: string;
    due_at: string;
    notes?: string;
  }>;
}

export default function CalendarView() {
  const [view, setView] = useState<View>("month");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const calendarWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchCalendarData();
  }, []);

  // Reposition the "+N more" overlay so it never goes off-screen
  useEffect(() => {
    const wrapper = calendarWrapperRef.current;
    if (!wrapper) return;

    const repositionOverlay = () => {
      const overlay = wrapper.querySelector<HTMLElement>(".rbc-overlay");
      if (!overlay) return;

      // Reset any previous positioning so we can measure naturally
      overlay.style.position = "fixed";
      overlay.style.transform = "none";

      const rect = overlay.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pad = 8;

      let newLeft = rect.left;
      let newTop = rect.top;

      // Clamp horizontally
      if (newLeft + rect.width > vw - pad) newLeft = vw - pad - rect.width;
      if (newLeft < pad) newLeft = pad;

      // Clamp vertically
      if (newTop + rect.height > vh - pad) newTop = vh - pad - rect.height;
      if (newTop < pad) newTop = pad;

      overlay.style.left = `${newLeft}px`;
      overlay.style.top = `${newTop}px`;
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLElement && (node.classList.contains("rbc-overlay") || node.querySelector?.(".rbc-overlay"))) {
            // Small delay to let the browser finish layout
            requestAnimationFrame(repositionOverlay);
          }
        }
      }
    });

    observer.observe(wrapper, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const fetchCalendarData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard");
      if (res.ok) {
        const data: DashboardData = await res.json();
        const calendarEvents: CalendarEvent[] = [];

        // Sort priority offsets (subtracted from start time in ms)
        // Lower priority number = appears first: green(session) → orange(first_session) → purple(session reminder) → blue(call/follow-up)
        const SORT_OFFSETS: Record<string, number> = {
          session: 5,      // green - first
          first_session: 4, // orange - second
          call: 3,         // red - third
          session_reminder: 2, // purple - fourth
          follow_up_reminder: 0, // blue - fifth
        };

        const getSortKey = (type: string, reminderType?: string): string => {
          if (type === "reminder") {
            return (reminderType || "").startsWith("session_") ? "session_reminder" : "follow_up_reminder";
          }
          return type;
        };

        // Add calls (only those with a date set)
        data.upcomingCalls?.forEach((call) => {
          if (!call.call_date_time) return; // Skip calls without a date
          const startDate = new Date(call.call_date_time);
          if (isNaN(startDate.getTime())) return; // Skip invalid dates
          const endDate = new Date(startDate.getTime() + 30 * 60000); // 30 min default
          calendarEvents.push({
            id: `call-${call.id}`,
            title: `📞 Call: ${call.name}`,
            start: new Date(startDate.getTime() - SORT_OFFSETS.call),
            end: endDate,
            type: "call",
            resource: {
              parent_name: call.name,
              originalStart: startDate,
              originalEnd: endDate,
            },
          });
        });

        // Add first sessions
        data.upcomingFirstSessions?.forEach((session) => {
          const startDate = new Date(session.session_date);
          const endDate = new Date(startDate.getTime() + 60 * 60000); // 1 hour default
          calendarEvents.push({
            id: `first-session-${session.id}`,
            title: `⭐ First Session: ${session.parent_name}`,
            start: new Date(startDate.getTime() - SORT_OFFSETS.first_session),
            end: endDate,
            type: "first_session",
            resource: {
              parent_name: session.parent_name,
              player_names: session.player_names,
              location: session.location,
              status: session.status,
              originalStart: startDate,
              originalEnd: endDate,
            },
          });
        });

        // Add regular sessions
        data.upcomingSessions?.forEach((session) => {
          const startDate = new Date(session.session_date);
          const endDate = new Date(startDate.getTime() + 60 * 60000); // 1 hour default
          calendarEvents.push({
            id: `session-${session.id}`,
            title: `⚽ Session: ${session.parent_name}`,
            start: new Date(startDate.getTime() - SORT_OFFSETS.session),
            end: endDate,
            type: "session",
            resource: {
              parent_name: session.parent_name,
              player_names: session.player_names,
              location: session.location,
              status: session.status,
              originalStart: startDate,
              originalEnd: endDate,
            },
          });
        });

        // Add ALL reminders for calendar
        data.upcomingReminders?.forEach((reminder) => {
          const dueDate = new Date(reminder.due_at);
          const sortKey = getSortKey("reminder", reminder.reminder_type);
          calendarEvents.push({
            id: `reminder-${reminder.id}`,
            title: `💬 Message: ${reminder.parent_name}`,
            start: new Date(dueDate.getTime() - (SORT_OFFSETS[sortKey] || 0)),
            end: dueDate,
            type: "reminder",
            resource: {
              parent_name: reminder.parent_name,
              reminder_type: reminder.reminder_type,
              notes: reminder.notes,
              originalStart: dueDate,
              originalEnd: dueDate,
            },
          });
        });

        setEvents(calendarEvents);
      }
    } catch (error) {
      console.error("Error fetching calendar data:", error);
    } finally {
      setLoading(false);
    }
  };

  const eventStyleGetter = (event: CalendarEvent) => {
    let backgroundColor = "#3174ad";

    switch (event.type) {
      case "call":
        backgroundColor = "#f44336"; // Red
        break;
      case "first_session":
        backgroundColor = "#ff9800"; // Orange
        break;
      case "session":
        backgroundColor = "#4caf50"; // Green
        break;
      case "reminder":
        // Session reminders (48h, 24h, 6h) = Purple
        // Follow-up reminders (1d, 3d, 7d, 14d) = Blue
        const reminderType = event.resource?.reminder_type || "";
        if (reminderType.startsWith("session_")) {
          backgroundColor = "#9c27b0"; // Purple for session reminders
        } else if (reminderType.startsWith("follow_up_")) {
          backgroundColor = "#2196f3"; // Blue for follow-up reminders
        } else {
          backgroundColor = "#9c27b0"; // Default purple
        }
        break;
    }

    return {
      style: {
        backgroundColor,
        borderRadius: "5px",
        opacity: 0.9,
        color: "white",
        border: "0px",
        display: "block",
      },
    };
  };

  const handleSelectEvent = (event: CalendarEvent) => {
    setSelectedEvent(event);
  };

  const getEventTypeLabel = (type: string) => {
    switch (type) {
      case "call":
        return "📞 Phone Call";
      case "first_session":
        return "⭐ First Session";
      case "session":
        return "⚽ Training Session";
      case "reminder":
        return "💬 Reminder";
      default:
        return type;
    }
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ mb: 2 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 1.5,
            }}
          >
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Calendar View
            </Typography>
            <ToggleButtonGroup
              value={view}
              exclusive
              onChange={(e, newView) => newView && setView(newView)}
              size="small"
            >
              <ToggleButton value="day">Day</ToggleButton>
              <ToggleButton value="week">Week</ToggleButton>
              <ToggleButton value="month">Month</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 2,
              alignItems: "center",
              py: 1,
              px: 1.5,
              borderRadius: 1,
              bgcolor: "action.hover",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Box
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: "4px",
                  bgcolor: "#ff9800",
                }}
              />
              <Typography variant="body2" color="text.secondary">
                First session
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Box
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: "4px",
                  bgcolor: "#4caf50",
                }}
              />
              <Typography variant="body2" color="text.secondary">
                Session
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Box
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: "4px",
                  bgcolor: "#f44336",
                }}
              />
              <Typography variant="body2" color="text.secondary">
                Call
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Box
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: "4px",
                  bgcolor: "#2196f3",
                }}
              />
              <Typography variant="body2" color="text.secondary">
                Reminder follow-up
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Box
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: "4px",
                  bgcolor: "#9c27b0",
                }}
              />
              <Typography variant="body2" color="text.secondary">
                Reminder session
              </Typography>
            </Box>
          </Box>
        </Box>

        {loading ? (
          <Typography color="text.secondary">Loading calendar...</Typography>
        ) : (
          <Box
            ref={calendarWrapperRef}
            sx={{
              height: 600,
              width: "100%",
              overflow: "visible",
              position: "relative",
              "& .rbc-calendar": {
                minWidth: "100%",
              },
              "& .rbc-month-view": {
                overflow: "visible",
              },
              "& .rbc-day-bg": {
                overflow: "visible",
              },
              "& .rbc-event": {
                padding: "2px 4px",
                fontSize: "0.85rem",
              },
              "& .rbc-show-more": {
                cursor: "pointer",
                color: "#1976d2",
                fontWeight: 600,
                "&:hover": {
                  textDecoration: "underline",
                },
              },
              "& .rbc-overlay": {
                minWidth: "300px !important",
                maxWidth: "400px !important",
                maxHeight: "60vh !important",
                overflow: "auto !important",
                boxShadow: "0 8px 24px rgba(0,0,0,0.25) !important",
                zIndex: 9999,
                backgroundColor: "white",
                border: "1px solid #ddd",
                borderRadius: "8px",
                padding: "12px",
              },
              "& .rbc-overlay-header": {
                position: "sticky",
                top: "-12px",
                backgroundColor: "white",
                zIndex: 1,
                borderBottom: "2px solid #e0e0e0",
                padding: "8px 0 12px 0",
                marginBottom: "8px",
                fontWeight: 700,
                fontSize: "1rem",
              },
              "& .rbc-event-content": {
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
            }}
          >
            <Calendar
              localizer={localizer}
              events={events}
              startAccessor="start"
              endAccessor="end"
              view={view}
              onView={setView}
              onSelectEvent={handleSelectEvent}
              eventPropGetter={eventStyleGetter}
              popup
              style={{ height: "100%", minHeight: "600px" }}
            />
          </Box>
        )}

        {/* Event Detail Dialog */}
        <Dialog
          open={!!selectedEvent}
          onClose={() => setSelectedEvent(null)}
          maxWidth="sm"
          fullWidth
        >
          {selectedEvent && (
            <>
              <DialogTitle>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {getEventTypeLabel(selectedEvent.type)}
                  <Chip
                    label={selectedEvent.type.replace("_", " ").toUpperCase()}
                    size="small"
                    color={
                      selectedEvent.type === "call"
                        ? "error"
                        : selectedEvent.type === "first_session"
                        ? "warning"
                        : selectedEvent.type === "session"
                        ? "success"
                        : "secondary"
                    }
                  />
                </Box>
              </DialogTitle>
              <DialogContent>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {selectedEvent.resource?.parent_name && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Parent
                      </Typography>
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>
                        {selectedEvent.resource.parent_name}
                      </Typography>
                    </Box>
                  )}

                  {selectedEvent.resource?.player_names &&
                    selectedEvent.resource.player_names.length > 0 && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Players
                        </Typography>
                        <Typography variant="body1">
                          {selectedEvent.resource.player_names.join(", ")}
                        </Typography>
                      </Box>
                    )}

                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Time
                    </Typography>
                    <Typography variant="body1">
                      {format(
                        selectedEvent.resource?.originalStart ??
                          selectedEvent.start,
                        "PPpp"
                      )}
                      {(selectedEvent.resource?.originalStart
                        ? selectedEvent.resource.originalStart.getTime()
                        : selectedEvent.start.getTime()) !==
                        (selectedEvent.resource?.originalEnd
                          ? selectedEvent.resource.originalEnd.getTime()
                          : selectedEvent.end.getTime()) &&
                        ` - ${format(
                          selectedEvent.resource?.originalEnd ??
                            selectedEvent.end,
                          "p"
                        )}`}
                    </Typography>
                  </Box>

                  {selectedEvent.resource?.location && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Location
                      </Typography>
                      <Typography variant="body1">
                        {selectedEvent.resource.location}
                      </Typography>
                    </Box>
                  )}

                  {selectedEvent.resource?.status && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Status
                      </Typography>
                      <Typography variant="body1">
                        {selectedEvent.resource.status
                          .replace("_", " ")
                          .toUpperCase()}
                      </Typography>
                    </Box>
                  )}

                  {selectedEvent.resource?.reminder_type && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Reminder Type
                      </Typography>
                      <Typography variant="body1">
                        {selectedEvent.resource.reminder_type.replace(
                          /_/g,
                          " "
                        )}
                      </Typography>
                    </Box>
                  )}

                  {selectedEvent.resource?.notes && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Notes
                      </Typography>
                      <Typography variant="body1">
                        {selectedEvent.resource.notes}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </DialogContent>
            </>
          )}
        </Dialog>
      </CardContent>
    </Card>
  );
}
