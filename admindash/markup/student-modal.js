/**
 * Student Modal Component
 * Displays student details in a popup modal
 */

// Student data storage
let studentModalData = {
    name: '',
    studentId: '',
    grade: '',
    gender: '',
    phone: '',
    email: '',
    birthDate: '',
    enrollmentDate: '',
    school: '',
    teacher: '',
    status: '',
    address: '',
    householdAddress: '',
    family: []
};

/**
 * Initialize student modal - Bootstrap Modal
 */
function initStudentModal() {
    // Create modal HTML if it doesn't exist
    if (!document.getElementById('studentModal')) {
        createStudentModalHTML();
    }
    
    // Bootstrap modal handles close events automatically
    // But we can add custom event listeners if needed
    const modalElement = document.getElementById('studentModal');
    if (modalElement) {
        // Handle modal hidden event to reset state if needed
        modalElement.addEventListener('hidden.bs.modal', function() {
            // Reset modal state if needed
        });
    }
}

/**
 * Create student modal HTML structure - Bootstrap Modal
 */
function createStudentModalHTML() {
    const modalHTML = `
        <!-- Bootstrap Modal -->
        <div class="modal fade" id="studentModal" tabindex="-1" aria-labelledby="studentModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header border-bottom">
                        <div class="d-flex align-items-center gap-3 flex-grow-1">
                            <div class="student-modal-avatar rounded-circle bg-primary text-white d-flex align-items-center justify-content-center" style="width: 64px; height: 64px; font-size: 24px;">
                                <i class="bi bi-person"></i>
                            </div>
                            <div>
                                <h5 class="modal-title mb-1" id="student-modal-name">学生姓名</h5>
                                <p class="text-muted small mb-0" id="student-modal-info">学号：- | 年级：-</p>
                            </div>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <button type="button" class="btn btn-primary btn-sm">
                                <i class="bi bi-pencil me-1"></i>编辑
                            </button>
                            <button type="button" class="btn btn-outline-secondary btn-sm">
                                <i class="bi bi-download me-1"></i>导出
                            </button>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                    </div>
                    <div class="modal-body p-0">
                        <!-- Bootstrap Tabs -->
                        <ul class="nav nav-tabs border-bottom px-3" id="studentModalTabs" role="tablist">
                            <li class="nav-item" role="presentation">
                                <button class="nav-link active" id="basic-tab" data-bs-toggle="tab" data-bs-target="#basic" type="button" role="tab" aria-controls="basic" aria-selected="true">基本信息</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="family-tab" data-bs-toggle="tab" data-bs-target="#family" type="button" role="tab" aria-controls="family" aria-selected="false">家庭信息</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="courses-tab" data-bs-toggle="tab" data-bs-target="#courses" type="button" role="tab" aria-controls="courses" aria-selected="false">课程</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="schedule-tab" data-bs-toggle="tab" data-bs-target="#schedule" type="button" role="tab" aria-controls="schedule" aria-selected="false">每周日程</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="attendance-tab" data-bs-toggle="tab" data-bs-target="#attendance" type="button" role="tab" aria-controls="attendance" aria-selected="false">出勤日历</button>
                            </li>
                        </ul>
                        <div class="tab-content p-4" id="studentModalTabContent">
                            <div class="tab-pane fade show active" id="basic" role="tabpanel" aria-labelledby="basic-tab">
                                <!-- Basic info will be populated here -->
                            </div>
                            <div class="tab-pane fade" id="family" role="tabpanel" aria-labelledby="family-tab">
                                <!-- Family info will be populated here -->
                            </div>
                            <div class="tab-pane fade" id="courses" role="tabpanel" aria-labelledby="courses-tab">
                                <!-- Courses info will be populated here -->
                            </div>
                            <div class="tab-pane fade" id="schedule" role="tabpanel" aria-labelledby="schedule-tab">
                                <!-- Schedule will be populated here -->
                            </div>
                            <div class="tab-pane fade" id="attendance" role="tabpanel" aria-labelledby="attendance-tab">
                                <!-- Attendance will be populated here -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

/**
 * Switch tab - Bootstrap Tabs handle this automatically
 * This function is kept for compatibility and to trigger chart initialization
 */
function switchTab(tabName) {
    // Bootstrap tabs handle switching automatically via data-bs-toggle
    // We just need to trigger the chart initialization when attendance tab is shown
    const attendanceTab = document.getElementById('attendance-tab');
    if (attendanceTab && tabName === 'attendance') {
        // Listen for when the attendance tab is shown
        attendanceTab.addEventListener('shown.bs.tab', function() {
            setTimeout(initAttendanceChart, 100);
        }, { once: true });
    }
}

/**
 * Show student modal with data - Bootstrap Modal
 */
function showStudentModal(studentData) {
    // Update modal data
    studentModalData = { ...studentModalData, ...studentData };
    
    // Initialize modal if not already initialized
    if (!document.getElementById('studentModal')) {
        initStudentModal();
    }
    
    // Update header
    updateModalHeader();
    
    // Update tab content
    updateBasicInfoTab();
    updateFamilyInfoTab();
    updateCoursesTab();
    updateScheduleTab();
    updateAttendanceTab();
    
    // Show Bootstrap modal
    const modalElement = document.getElementById('studentModal');
    if (modalElement) {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
        
        // Switch to basic tab by default when modal is shown
        modalElement.addEventListener('shown.bs.modal', function() {
            const basicTab = document.getElementById('basic-tab');
            if (basicTab) {
                const tab = new bootstrap.Tab(basicTab);
                tab.show();
            }
        }, { once: true });
    }
}

/**
 * Close student modal - Bootstrap Modal
 */
function closeStudentModal() {
    const modalElement = document.getElementById('studentModal');
    if (modalElement) {
        const modal = bootstrap.Modal.getInstance(modalElement);
        if (modal) {
            modal.hide();
        }
    }
}

/**
 * Update modal header
 */
function updateModalHeader() {
    const nameEl = document.getElementById('student-modal-name');
    const infoEl = document.getElementById('student-modal-info');
    const avatarEl = document.querySelector('.student-modal-avatar');
    
    if (nameEl) {
        nameEl.textContent = studentModalData.name || '学生姓名';
    }
    
    if (infoEl) {
        const studentId = studentModalData.studentId || '-';
        const grade = studentModalData.grade || '-';
        infoEl.textContent = `学号：${studentId} | 年级：${grade}`;
    }
    
    if (avatarEl && studentModalData.name) {
        const firstChar = studentModalData.name.charAt(0);
        avatarEl.textContent = firstChar;
        avatarEl.style.background = getColorForName(studentModalData.name);
        avatarEl.style.color = '#fff';
    }
}

/**
 * Get color for name (avatar background)
 */
function getColorForName(name) {
    const colors = [
        '#6366f1', // indigo
        '#3b82f6', // blue
        '#ef4444', // red
        '#10b981', // green
        '#8b5cf6', // purple
        '#f59e0b'  // yellow
    ];
    const index = name ? name.charCodeAt(0) % colors.length : 0;
    return colors[index];
}

/**
 * Update basic info tab - Bootstrap Tab
 */
function updateBasicInfoTab() {
    const tabContent = document.getElementById('basic');
    if (!tabContent) return;
    
    const data = studentModalData;
    
    tabContent.innerHTML = `
        <div class="row g-4">
            <div class="col-md-6">
                <div class="card">
                    <div class="card-header">
                        <h5 class="mb-0">个人信息</h5>
                    </div>
                    <div class="card-body">
                        <div class="row g-3">
                            <div class="col-6">
                                <p class="text-muted small mb-1">姓名</p>
                                <p class="mb-0 fw-medium">${data.name || '-'}</p>
                            </div>
                            <div class="col-6">
                                <p class="text-muted small mb-1">学号</p>
                                <p class="mb-0 fw-medium">${data.studentId || '-'}</p>
                            </div>
                            <div class="col-6">
                                <p class="text-muted small mb-1">性别</p>
                                <p class="mb-0 fw-medium">${data.gender || '-'}</p>
                            </div>
                            <div class="col-6">
                                <p class="text-muted small mb-1">出生日期</p>
                                <p class="mb-0 fw-medium">${data.birthDate || '-'}</p>
                            </div>
                            <div class="col-6">
                                <p class="text-muted small mb-1">联系电话</p>
                                <p class="mb-0 fw-medium">${data.phone || '-'}</p>
                            </div>
                            <div class="col-6">
                                <p class="text-muted small mb-1">电子邮箱</p>
                                <p class="mb-0 fw-medium">${data.email || '-'}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="card">
                    <div class="card-header">
                        <h5 class="mb-0">学业信息</h5>
                    </div>
                    <div class="card-body">
                        <div class="row g-3">
                            <div class="col-6">
                                <p class="text-muted small mb-1">年级班级</p>
                                <p class="mb-0 fw-medium">${data.grade || '-'}</p>
                            </div>
                            <div class="col-6">
                                <p class="text-muted small mb-1">班主任</p>
                                <p class="mb-0 fw-medium">${data.teacher || '-'}</p>
                            </div>
                            <div class="col-6">
                                <p class="text-muted small mb-1">学生类型</p>
                                <p class="mb-0 fw-medium">普通</p>
                            </div>
                            <div class="col-6">
                                <p class="text-muted small mb-1">入学日期</p>
                                <p class="mb-0 fw-medium">${data.enrollmentDate || '-'}</p>
                            </div>
                            <div class="col-6">
                                <p class="text-muted small mb-1">学生状态</p>
                                <p class="mb-0 fw-medium text-success d-flex align-items-center">
                                    <i class="bi bi-circle-fill me-1" style="font-size: 0.5rem;"></i>
                                    ${data.status || '就读中'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-12">
                <div class="card">
                    <div class="card-header">
                        <h5 class="mb-0">联系地址</h5>
                    </div>
                    <div class="card-body">
                        <div class="mb-3">
                            <p class="text-muted small mb-1">现住地址</p>
                            <p class="mb-0 fw-medium">${data.address || '-'}</p>
                        </div>
                        <div>
                            <p class="text-muted small mb-1">户籍地址</p>
                            <p class="mb-0 fw-medium">${data.householdAddress || '-'}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Update family info tab
 */
function updateFamilyInfoTab() {
    const tabContent = document.getElementById('family');
    if (!tabContent) return;
    
    const family = studentModalData.family || [];
    
    let familyRows = '';
    if (family.length > 0) {
        familyRows = family.map(member => `
            <tr>
                <td>${member.name || '-'}</td>
                <td>${member.relation || '-'}</td>
                <td>${member.phone || '-'}</td>
                <td>${member.occupation || '-'}</td>
            </tr>
        `).join('');
    } else {
        // Default family data
        familyRows = `
            <tr>
                <td>${studentModalData.parent || '-'}</td>
                <td>家长</td>
                <td>${studentModalData.phone || '-'}</td>
                <td>-</td>
            </tr>
        `;
    }
    
    tabContent.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h5 class="mb-0">家庭成员信息</h5>
            </div>
            <div class="card-body p-0">
                <div class="table-responsive">
                    <table class="table table-hover mb-0">
                        <thead class="table-light">
                            <tr>
                                <th>姓名</th>
                                <th>关系</th>
                                <th>联系电话</th>
                                <th>职业</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${familyRows}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

/**
 * Update courses tab
 */
function updateCoursesTab() {
    const tabContent = document.getElementById('courses');
    if (!tabContent) return;
    
    tabContent.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h5 class="mb-0">课程信息</h5>
            </div>
            <div class="card-body">
                <p class="text-muted mb-0">暂无课程信息</p>
            </div>
        </div>
    `;
}

/**
 * Update schedule tab - Bootstrap compatible, dynamically generated from schedule data
 */
function updateScheduleTab() {
    const tabContent = document.getElementById('schedule');
    if (!tabContent) return;
    
    const studentName = studentModalData.name || '';
    const studentId = studentModalData.studentId || '-';
    const currentDate = new Date();
    const weekStart = new Date(currentDate);
    weekStart.setDate(currentDate.getDate() - currentDate.getDay() + 1);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    
    const formatDate = (date) => {
        return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    };
    
    // Get schedule data from global studentSchedules object
    const schedule = (window.studentSchedules && studentName && window.studentSchedules[studentName]) || null;
    
    // Color mapping for Bootstrap classes (matching program.html)
    const colorClasses = {
        'blue': 'bg-info bg-opacity-10 border-start border-4 border-info',
        'green': 'bg-success bg-opacity-10 border-start border-4 border-success',
        'red': 'bg-danger bg-opacity-10 border-start border-4 border-danger',
        'purple': 'bg-primary bg-opacity-10 border-start border-4 border-primary',
        'amber': 'bg-warning bg-opacity-10 border-start border-4 border-warning',
        'orange': 'bg-warning bg-opacity-10 border-start border-4 border-warning',
        'teal': 'bg-info bg-opacity-10 border-start border-4 border-info'
    };
    
    const textColorClasses = {
        'blue': 'text-info-emphasis',
        'green': 'text-success-emphasis',
        'red': 'text-danger-emphasis',
        'purple': 'text-primary-emphasis',
        'amber': 'text-warning-emphasis',
        'orange': 'text-warning-emphasis',
        'teal': 'text-info-emphasis'
    };
    
    // Status badge classes (matching program.html)
    const statusClasses = {
        '已签到': 'badge bg-secondary',
        '待签到': 'badge bg-warning text-dark'
    };
    
    // Generate schedule table HTML
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const timeSlots = ['morning', 'afternoon', 'evening'];
    const timeSlotLabels = ['上午<br/>08:30-12:00', '下午<br/>14:00-17:30', '晚上<br/>18:30-21:00'];
    
    let scheduleHTML = '';
    
    // Generate table rows for each time slot
    timeSlots.forEach((slot, slotIndex) => {
        scheduleHTML += '<tr>';
        // Time slot column
        scheduleHTML += `<td class="px-3 py-4 text-nowrap small fw-medium bg-light" style="border: 1px solid #e5e7eb;">${timeSlotLabels[slotIndex]}</td>`;
        
        // Generate cells for each day
        days.forEach((day) => {
            if (schedule && schedule[day] && schedule[day][slot]) {
                const course = schedule[day][slot];
                const colorClass = colorClasses[course.color] || colorClasses['blue'];
                const textColorClass = textColorClasses[course.color] || textColorClasses['blue'];
                const statusClass = statusClasses[course.status] || statusClasses['已签到'];
                
                scheduleHTML += `<td class="px-3 py-4 text-nowrap" style="border: 1px solid #e5e7eb;">`;
                scheduleHTML += `<div class="${colorClass} p-2 rounded">`;
                scheduleHTML += `<p class="fw-medium ${textColorClass} small mb-1">${course.course || ''}</p>`;
                scheduleHTML += `<p class="small text-muted mb-1">${course.time || ''}</p>`;
                scheduleHTML += `<p class="small text-secondary mb-1">${course.teacher || ''} | ${course.room || ''}</p>`;
                scheduleHTML += `<p class="${statusClass} small mb-0">${course.status || '已签到'}</p>`;
                scheduleHTML += `</div>`;
                scheduleHTML += `</td>`;
            } else {
                scheduleHTML += `<td class="px-3 py-4 text-nowrap small text-muted" style="border: 1px solid #e5e7eb;"></td>`;
            }
        });
        
        scheduleHTML += '</tr>';
    });
    
    tabContent.innerHTML = `
        <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center border-bottom">
                <div>
                    <h5 class="mb-0 fw-bold">个人课程安排表</h5>
                    <p class="small text-muted mb-0 mt-1">${formatDate(weekStart)} - ${formatDate(weekEnd)} | 学号：${studentId}</p>
                </div>
                <div class="d-flex gap-2">
                    <button class="btn btn-outline-secondary btn-sm d-flex align-items-center">
                        <i class="bi bi-printer me-1"></i>
                        打印
                    </button>
                    <button class="btn btn-outline-secondary btn-sm d-flex align-items-center">
                        <i class="bi bi-calendar-month me-1"></i>
                        切换周次
                    </button>
                </div>
            </div>
            <div class="card-body p-0">
                <div class="table-responsive">
                    <table class="table table-bordered mb-0">
                        <thead>
                            <tr>
                                <th class="w-20 py-2 px-3 bg-light text-start small fw-medium text-muted text-uppercase" style="border: 1px solid #e5e7eb;">时段</th>
                                <th class="py-2 px-3 bg-light text-start small fw-medium text-muted text-uppercase" style="border: 1px solid #e5e7eb;">周一</th>
                                <th class="py-2 px-3 bg-light text-start small fw-medium text-muted text-uppercase" style="border: 1px solid #e5e7eb;">周二</th>
                                <th class="py-2 px-3 bg-light text-start small fw-medium text-muted text-uppercase" style="border: 1px solid #e5e7eb;">周三</th>
                                <th class="py-2 px-3 bg-light text-start small fw-medium text-muted text-uppercase" style="border: 1px solid #e5e7eb;">周四</th>
                                <th class="py-2 px-3 bg-light text-start small fw-medium text-muted text-uppercase" style="border: 1px solid #e5e7eb;">周五</th>
                                <th class="py-2 px-3 bg-light text-start small fw-medium text-muted text-uppercase" style="border: 1px solid #e5e7eb;">周六</th>
                                <th class="py-2 px-3 bg-light text-start small fw-medium text-muted text-uppercase" style="border: 1px solid #e5e7eb;">周日</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${scheduleHTML}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

/**
 * Update attendance tab
 */
function updateAttendanceTab() {
    const tabContent = document.getElementById('attendance');
    if (!tabContent) return;
    
    tabContent.innerHTML = `
        <div class="card">
            <h2 class="text-lg font-semibold mb-4 pb-2 border-b">2025年11月出勤记录</h2>
            <div class="chart-container" id="student-modal-attendance-chart" style="width: 100%; height: 400px;"></div>
        </div>
    `;
}

/**
 * Initialize attendance chart
 */
function initAttendanceChart() {
    const chartDom = document.getElementById('student-modal-attendance-chart');
    if (!chartDom || typeof echarts === 'undefined') return;
    
    const myChart = echarts.init(chartDom);
    
    const option = {
        tooltip: {},
        visualMap: {
            min: 0,
            max: 1,
            type: 'piecewise',
            orient: 'horizontal',
            right: 20,
            top: 0,
            pieces: [
                {value: 1, label: '到校', color: '#52c41a'},
                {value: 0, label: '缺席', color: '#ff4d4f'}
            ]
        },
        calendar: {
            top: 40,
            left: 30,
            right: 30,
            cellSize: ['auto', 20],
            range: '2025-11',
            itemStyle: {
                borderWidth: 0.5
            },
            dayLabel: {
                nameMap: 'ZH'
            },
            monthLabel: {
                nameMap: 'ZH'
            },
            yearLabel: {show: false}
        },
        series: {
            type: 'heatmap',
            coordinateSystem: 'calendar',
            data: generateAttendanceData()
        }
    };
    
    myChart.setOption(option);
    
    // Resize chart on window resize
    window.addEventListener('resize', function() {
        myChart.resize();
    });
}

/**
 * Generate attendance data
 */
function generateAttendanceData() {
    const data = [];
    for (let day = 1; day <= 30; day++) {
        const dateStr = '2025-11-' + day.toString().padStart(2, '0');
        const date = new Date(dateStr);
        
        if (date.getDay() === 0 || date.getDay() === 6) {
            data.push([dateStr, 0]);
        } else {
            data.push([dateStr, Math.random() > 0.1 ? 1 : 0]);
        }
    }
    return data;
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStudentModal);
} else {
    initStudentModal();
}

