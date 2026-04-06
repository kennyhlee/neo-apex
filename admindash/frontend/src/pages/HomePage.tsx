import { useEffect, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useDashboard } from '../contexts/DashboardContext.tsx';
import './HomePage.css';

const scheduleData = [
  {
    day: 0,
    events: [
      { time: '09:00-10:30', title: 'Math', location: 'Grade 3-2', type: 'course' as const },
      { time: '14:00-15:30', title: 'Staff Meeting', location: 'All Staff', type: 'meeting' as const },
    ],
  },
  {
    day: 1,
    events: [
      { time: '10:00-11:30', title: 'English', location: 'Grade 4-1', type: 'course' as const },
      { time: '16:00-17:00', title: 'Club Activity', location: 'Art Room', type: 'activity' as const },
    ],
  },
  { day: 2, events: [{ time: '08:30-10:00', title: 'Science Lab', location: 'Lab', type: 'activity' as const }] },
  {
    day: 3,
    events: [
      { time: '09:30-11:00', title: 'Chinese', location: 'Grade 3-3', type: 'course' as const },
      { time: '13:30-15:00', title: 'Class Meeting', location: 'Room 201', type: 'meeting' as const },
    ],
  },
  {
    day: 4,
    events: [
      { time: '08:30-10:00', title: 'Physics', location: 'Grade 5-2', type: 'course' as const },
      { time: '15:00-16:30', title: 'Sports Day Prep', location: 'Field', type: 'activity' as const },
    ],
  },
  { day: 5, events: [{ time: 'All Day', title: 'Parent Open Day', location: 'Campus', type: 'activity' as const }] },
  { day: 6, events: [{ time: '10:00-12:00', title: 'Showcase', location: 'Gym', type: 'activity' as const }] },
];

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface HomePageProps {
  tenant: string;
}

export default function HomePage({ tenant }: HomePageProps) {
  const { t } = useTranslation();
  const { getStudentCount } = useDashboard();
  const [studentCount, setStudentCount] = useState<number | null>(null);

  useEffect(() => {
    if (!tenant) return;
    getStudentCount(tenant).then(setStudentCount);
  }, [tenant, getStudentCount]);

  return (
    <div className="home-page">
      <h1>{t('homepage.title')}</h1>

      <div className="home-stats">
        <div className="stat-card">
          <div className="stat-label">{t('homepage.totalStudents')}</div>
          <div className="stat-value purple">{studentCount === null ? '\u2014' : studentCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('homepage.attendanceRate')}</div>
          <div className="stat-value blue">98%</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('homepage.totalCourses')}</div>
          <div className="stat-value green">22</div>
        </div>
      </div>

      <div className="home-grid">
        <div className="home-card">
          <div className="home-card-header">{t('homepage.quickActions')}</div>
          <div className="home-card-body">
            <div className="shortcut-grid">
              <div className="shortcut-item">
                <span className="shortcut-icon">&#128101;</span>
                <span className="shortcut-label">{t('nav.student')}</span>
              </div>
              <div className="shortcut-item">
                <span className="shortcut-icon">&#128197;</span>
                <span className="shortcut-label">{t('homepage.schedule')}</span>
              </div>
              <div className="shortcut-item">
                <span className="shortcut-icon">&#128203;</span>
                <span className="shortcut-label">{t('homepage.viewReports')}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="home-card">
          <div className="home-card-header">{t('homepage.todoItems')}</div>
          <div className="home-card-body">
            <div className="todo-item">
              <div className="todo-bar">
                <div className="todo-bar-fill" style={{ width: '70%', background: 'var(--success)' }} />
              </div>
              <div className="todo-text">Prepare new semester plan</div>
              <div className="todo-date">Due: 2025-10-30</div>
            </div>
            <div className="todo-item">
              <div className="todo-bar">
                <div className="todo-bar-fill" style={{ width: '40%', background: 'var(--warning)' }} />
              </div>
              <div className="todo-text">Update grading system</div>
              <div className="todo-date">Due: 2025-10-28</div>
            </div>
          </div>
        </div>

        <div className="home-card">
          <div className="home-card-header">{t('homepage.announcements')}</div>
          <div className="home-card-body">
            <div className="announce-item">
              <div className="announce-date">2025-10-20</div>
              <div className="announce-text">Teacher training session on Oct 25 at 2:00 PM in the conference room.</div>
            </div>
            <div className="announce-item">
              <div className="announce-date">2025-10-18</div>
              <div className="announce-text">Holiday schedule adjustment for November — check email for details.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="schedule-card">
        <div className="schedule-header">
          <span className="schedule-title">{t('homepage.weeklySchedule')}</span>
        </div>
        <div className="schedule-body">
          <div className="schedule-days">
            {days.map((d) => (
              <div key={d} className="schedule-day-header">{d}</div>
            ))}
            {days.map((_, idx) => {
              const dayData = scheduleData.find((s) => s.day === idx);
              return (
                <div key={idx} className="schedule-day-cell">
                  {dayData?.events.map((ev, i) => (
                    <div key={i} className={`schedule-event ${ev.type}`}>
                      <div className="schedule-event-time">{ev.time}</div>
                      <div className="schedule-event-title">{ev.title}</div>
                      <div className="schedule-event-location">{ev.location}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="schedule-legend">
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#60A5FA' }} />
              <span>Course</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#FBBF24' }} />
              <span>Meeting</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#34D399' }} />
              <span>Activity</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
