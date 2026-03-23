// Shared navbar component
const STORAGE_KEYS = {
    tenantId: 'apex-current-tenant-id',
    tenantName: 'apex-current-tenant-name'
};

const API_BASE = 'http://localhost:8080';
const DEFAULT_TENANT = 'acmechildcenter';

const navbarConfig = {
    logo: {
        src: 'https://www.acmeschool.com/uploads/2/7/1/4/27147223/1418317113.png',
        alt: 'Logo',
        height: '32px'
    },
    navItems: [
        { textKey: 'nav.home', href: 'homepage.html', id: 'home' },
        { textKey: 'nav.lead', href: 'lead.html', id: 'lead' },
        { textKey: 'nav.student', href: 'students.html', id: 'student' },
        { textKey: 'nav.program', href: 'program.html', id: 'program' },
        { textKey: 'nav.teacher', href: '#', id: 'teacher' },
        { textKey: 'nav.report', href: '#', id: 'report' }
    ],
    currentPage: '',
    sites: [],
    currentSite: { id: null, name: null },
    userName: '张老师',
    userAvatar: '张'
};

let cachedTenants = null;
let pendingTenants = null;

async function fetchTenants() {
    if (cachedTenants) return cachedTenants;
    if (pendingTenants) return pendingTenants;
    pendingTenants = (async () => {
        try {
            const resp = await fetch(`${API_BASE}/tenants`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const parsed = (data.tenants || []).map(t => ({ id: t.id, name: t.name || t.id })).filter(t => t.id);
            cachedTenants = parsed.length ? parsed : null;
        } catch (err) {
            console.error('Failed to fetch tenants', err);
            cachedTenants = null;
        } finally {
            pendingTenants = null;
        }
        return cachedTenants || [{ id: DEFAULT_TENANT, name: DEFAULT_TENANT }];
    })();
    return pendingTenants;
}

function renderSiteDropdown(config) {
    const dropdown = document.querySelector('.site-dropdown');
    if (!dropdown) return;
    dropdown.innerHTML = (config.sites || []).map(site => {
        const siteId = site.id || site.key || site;
        const siteName = site.name || (site.key ? site.key : siteId);
        return `<li><a class="dropdown-item site-option" href="#" data-site-id="${siteId}" data-site-name="${siteName}">${siteName}</a></li>`;
    }).join('');
}

function createNavbarHTML(config) {
    const getText = (key) => {
        if (window.i18n && window.i18n.t) return window.i18n.t(key);
        return key;
    };

    const currentSiteText = config.currentSite?.name || config.currentSite?.id || '';
    const currentSiteId = config.currentSite?.id || '';
    const currentLang = (window.i18n && window.i18n.getCurrentLanguage && window.i18n.getCurrentLanguage()) || 'zh-CN';

    const navItemsHTML = config.navItems.map(item => {
        const isActive = config.currentPage === item.href || (config.currentPage.includes(item.id) && item.id !== 'home');
        const text = item.textKey ? getText(item.textKey) : (item.text || '');
        return `<li class="nav-item">
            <a class="nav-link${isActive ? ' active' : ''}" href="${item.href}" data-href="${item.href}" ${item.textKey ? `data-i18n="${item.textKey}"` : ''}>${text}</a>
        </li>`;
    }).join('');

    const siteDropdownItemsHTML = (config.sites || []).map(site => {
        const siteId = site.id || site.key || site;
        const siteName = site.name || siteId;
        return `<li><a class="dropdown-item site-option" href="#" data-site-id="${siteId}" data-site-name="${siteName}">${siteName}</a></li>`;
    }).join('');

    return `
<nav class="navbar navbar-expand-lg navbar-light bg-white border-bottom shadow-sm mb-3 top-navbar">
  <div class="container-fluid">
    ${config.logo && config.logo.src ? `<a class="navbar-brand d-flex align-items-center" href="#"><img src="${config.logo.src}" alt="${config.logo.alt || 'Logo'}" style="height:${config.logo.height || '32px'};"></a>` : `<span class="navbar-brand mb-0 h1" data-i18n="nav.systemName">成长学苑管理系统</span>`}
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav" aria-controls="navbarNav" aria-expanded="false" aria-label="Toggle navigation">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse" id="navbarNav">
      <ul class="navbar-nav me-auto mb-2 mb-lg-0">${navItemsHTML}</ul>
      <div class="d-flex align-items-center gap-3">
        <span class="text-muted small" data-i18n="nav.currentSite">当前校区</span>: <span class="current-site-text" data-site-id="${currentSiteId}">${currentSiteText}</span>
        <div class="dropdown">
          <a class="d-flex align-items-center text-decoration-none text-dark user-menu" href="#" role="button" id="userDropdown" data-bs-toggle="dropdown" aria-expanded="false">
            <div class="avatar rounded-circle bg-primary text-white d-flex align-items-center justify-content-center me-2" style="width:32px;height:32px;font-size:14px;">${config.userAvatar}</div>
            <span>${config.userName}</span>
            <i class="bi bi-chevron-down ms-2"></i>
          </a>
          <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="userDropdown" data-bs-auto-close="outside">
            <li class="dropend">
              <a class="dropdown-item dropdown-toggle d-flex align-items-center justify-content-between" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">
                <span data-i18n="nav.switchSite"><i class="bi bi-geo-alt me-2"></i>切换校区</span>
              </a>
              <ul class="dropdown-menu site-dropdown">${siteDropdownItemsHTML}</ul>
            </li>
            <li class="dropend">
              <a class="dropdown-item dropdown-toggle d-flex align-items-center justify-content-between" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">
                <span><i class="bi bi-globe me-2"></i><span data-i18n="nav.language">语言</span></span>
                <span class="lang-display ms-2 text-muted small">${currentLang === 'zh-CN' ? '中文' : 'English'}</span>
              </a>
              <ul class="dropdown-menu lang-dropdown">
                <li><a class="dropdown-item lang-option ${currentLang === 'zh-CN' ? 'active' : ''}" href="#" data-lang="zh-CN">中文</a></li>
                <li><a class="dropdown-item lang-option ${currentLang === 'en-US' ? 'active' : ''}" href="#" data-lang="en-US">English</a></li>
              </ul>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</nav>`;
}

function initNavbarInteractions(config) {
    const bindSiteOptions = () => {
        const siteOptions = document.querySelectorAll('.site-option');
        const currentSiteText = document.querySelector('.current-site-text');
        siteOptions.forEach(option => {
            option.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                const siteId = this.getAttribute('data-site-id');
                const siteName = this.getAttribute('data-site-name') || this.textContent.trim();
                if (currentSiteText) {
                    currentSiteText.textContent = siteName;
                    currentSiteText.setAttribute('data-site-id', siteId);
                }
                siteOptions.forEach(opt => opt.classList.remove('active'));
                this.classList.add('active');
                document.dispatchEvent(new CustomEvent('siteChanged', {
                    detail: { siteId, siteName, site: siteName, siteKey: siteId }
                }));
                document.querySelectorAll('.dropdown-toggle').forEach(toggle => {
                    const dropdown = bootstrap.Dropdown.getInstance(toggle);
                    if (dropdown) dropdown.hide();
                });
            });
        });
    };

    // Refresh tenants when opening the site dropdown
    const siteToggle = document.querySelector('.dropend > .dropdown-toggle[data-bs-toggle="dropdown"]');
    if (siteToggle && siteToggle.nextElementSibling && siteToggle.nextElementSibling.classList.contains('site-dropdown')) {
        siteToggle.addEventListener('show.bs.dropdown', async function() {
            const tenants = await fetchTenants();
            if (tenants.length) {
                config.sites = tenants;
                renderSiteDropdown(config);
                bindSiteOptions();
            }
        });
    }

    // No localStorage loading to force default

    // Language switcher
    const langOptions = document.querySelectorAll('.lang-option');
    const langDisplay = document.querySelector('.lang-display');
    langOptions.forEach(option => {
        option.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const lang = this.getAttribute('data-lang');
            if (lang && window.i18n && window.i18n.setLanguage) {
                window.i18n.setLanguage(lang);
                if (langDisplay) langDisplay.textContent = lang === 'zh-CN' ? '中文' : 'English';
                langOptions.forEach(opt => opt.classList.remove('active'));
                this.classList.add('active');
                document.querySelectorAll('.dropdown-toggle').forEach(toggle => {
                    const dropdown = bootstrap.Dropdown.getInstance(toggle);
                    if (dropdown) dropdown.hide();
                });
            }
        });
    });
}

async function initNavbar(config = {}, containerSelector = null) {
    const finalConfig = { ...navbarConfig, ...config };

    const tenants = await fetchTenants();
    if (tenants.length) {
        finalConfig.sites = tenants;
    } else if (!finalConfig.sites.length) {
        finalConfig.sites = [{ id: DEFAULT_TENANT, name: DEFAULT_TENANT }];
    }

    const preferred = finalConfig.sites.find(s => s.id === DEFAULT_TENANT);
    const fallback = preferred || finalConfig.sites[0] || { id: DEFAULT_TENANT, name: DEFAULT_TENANT };
    finalConfig.currentSite = { id: fallback.id, name: fallback.name || fallback.id };

    if (!finalConfig.currentPage) {
        const currentPath = window.location.pathname;
        finalConfig.currentPage = currentPath.split('/').pop() || 'homepage.html';
    }

    const navbarHTML = createNavbarHTML(finalConfig);
    let container = containerSelector ? document.querySelector(containerSelector) : document.querySelector('.container') || document.body;
    if (container) {
        if (container.tagName === 'BODY') container.insertAdjacentHTML('afterbegin', navbarHTML);
        else container.insertAdjacentHTML('afterbegin', navbarHTML);
    }
    renderSiteDropdown(finalConfig);
    initNavbarInteractions(finalConfig);
}

document.addEventListener('DOMContentLoaded', async function() {
    const existingNavbar = document.querySelector('.top-navbar');
    if (existingNavbar) {
        const tenants = await fetchTenants();
        if (tenants.length) {
            navbarConfig.sites = tenants.map(t => ({ id: t.id, name: t.name || t.id }));
            const preferred = tenants.find(t => t.id === DEFAULT_TENANT) || tenants[0];
            navbarConfig.currentSite = { id: preferred.id, name: preferred.name || preferred.id };
        } else {
            navbarConfig.sites = [{ id: DEFAULT_TENANT, name: DEFAULT_TENANT }];
            navbarConfig.currentSite = { id: DEFAULT_TENANT, name: DEFAULT_TENANT };
        }
        renderSiteDropdown(navbarConfig);
        initNavbarInteractions(navbarConfig);
    }
});

