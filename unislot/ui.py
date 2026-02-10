"""Streamlit UI for UniSlot scheduling system."""

# pyright: basic

import concurrent.futures
import io
import time
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Optional

import pandas as pd
import streamlit as st

from unislot.models import ClashReport, ClashStatus, Schedule
from unislot.output import export_all, export_clash_report_xlsx, export_fixed_schedule_xlsx
from unislot.parser import load_and_validate, parse_presorted_schedule
from unislot.preprocessing import (
    assign_students_to_sections,
    build_conflict_graph,
    compute_section_splits,
    extract_faculty_constraints,
)
from unislot.scheduler import (
    build_schedule,
    compute_clash_report,
    run_scheduler,
    analyze_presorted_schedule_clashes,
    optimize_presorted_schedule,
)

# ============== SVG ICONS ==============
ICONS = {
    "logo":
    '''<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="10" fill="url(#grad1)"/>
        <path d="M12 14h16v3H12v-3zm0 5h16v3H12v-3zm0 5h10v3H12v-3z" fill="white" opacity="0.9"/>
        <circle cx="30" cy="28" r="5" fill="#10B981"/>
        <path d="M28 28l1.5 1.5 3-3" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
        <defs><linearGradient id="grad1" x1="0" y1="0" x2="40" y2="40">
            <stop offset="0%" stop-color="#3B82F6"/><stop offset="100%" stop-color="#1E3A8A"/>
        </linearGradient></defs>
    </svg>''',
    "calendar":
    '''<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>''',
    "search":
    '''<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>''',
    "settings":
    '''<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>''',
    "upload":
    '''<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>''',
    "check":
    '''<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>''',
    "alert":
    '''<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>''',
    "download":
    '''<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>''',
    "play":
    '''<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>''',
    "fix":
    '''<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>''',
    "file":
    '''<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>''',
}

# ============== PAGE CONFIG & STYLING ==============

st.set_page_config(
    page_title="UniSlot - Smart Course Scheduler",
    page_icon=
    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' rx='10' fill='%233B82F6'/></svg>",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom CSS for clean, minimal design
st.markdown("""
<style>
    /* Import fonts */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    
    /* Global styling */
    .stApp {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        background: #0f172a;
        color: #e2e8f0;
    }
    
    /* Hide streamlit elements */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: visible;}
    
    /* Main container */
    .main .block-container {
        padding-top: 2rem;
        max-width: 1200px;
    }
    
    /* ===== HEADER ===== */
    .main-header {
        background: #1e293b;
        padding: 2rem 2rem 1.75rem 2rem;
        border-radius: 12px;
        margin-bottom: 2rem;
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    
    .header-content {
        display: flex;
        align-items: center;
        gap: 1rem;
    }
    
    .main-header h1 {
        color: white;
        font-size: 2.25rem;
        font-weight: 700;
        margin: 0;
        letter-spacing: -0.02em;
    }
    
    .main-header p {
        color: #94a3b8;
        font-size: 0.95rem;
        font-weight: 400;
        margin: 0.5rem 0 0 0;
    }
    
    /* ===== SECTION HEADERS ===== */
    .section-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin: 2rem 0 1rem 0;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    
    .section-header h2 {
        color: #f1f5f9;
        font-size: 1.25rem;
        font-weight: 600;
        margin: 0;
    }
    
    .section-number {
        background: #3b82f6;
        color: white;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 0.875rem;
    }
    
    /* ===== METRIC CARDS ===== */
    .metric-container {
        background: #1e293b;
        border-radius: 10px;
        padding: 1.25rem;
        border: 1px solid rgba(255, 255, 255, 0.08);
        transition: all 0.2s ease;
    }
    
    .metric-container:hover {
        border-color: rgba(255, 255, 255, 0.15);
        transform: translateY(-2px);
    }
    
    .metric-label {
        color: #94a3b8;
        font-size: 0.813rem;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.5rem;
    }
    
    .metric-value {
        color: #f1f5f9;
        font-size: 1.75rem;
        font-weight: 700;
    }
    
    .metric-value.success { color: #10b981; }
    .metric-value.danger { color: #ef4444; }
    .metric-value.primary { color: #3b82f6; }
    
    /* ===== STATUS BADGE ===== */
    .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border-radius: 6px;
        font-weight: 500;
        font-size: 0.875rem;
    }
    
    .status-badge.success {
        background: rgba(16, 185, 129, 0.1);
        color: #10b981;
        border: 1px solid rgba(16, 185, 129, 0.2);
    }
    
    .status-badge.danger {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.2);
    }
    
    /* ===== UPLOAD AREA ===== */
    .upload-area {
        background: #1e293b;
        border: 2px dashed rgba(100, 116, 139, 0.3);
        border-radius: 12px;
        padding: 2.5rem 2rem;
        text-align: center;
        transition: all 0.2s ease;
    }
    
    .upload-area:hover {
        border-color: #3b82f6;
        background: rgba(59, 130, 246, 0.05);
    }
    
    .upload-icon {
        opacity: 0.6;
        margin-bottom: 1rem;
    }
    
    /* ===== INFO CARDS ===== */
    .info-card {
        background: #1e293b;
        border-radius: 10px;
        padding: 1.25rem;
        border: 1px solid rgba(255, 255, 255, 0.08);
        margin-bottom: 1rem;
    }
    
    .info-card.success {
        background: rgba(16, 185, 129, 0.08);
        border-color: rgba(16, 185, 129, 0.2);
    }
    
    .info-card.warning {
        background: rgba(245, 158, 11, 0.08);
        border-color: rgba(245, 158, 11, 0.2);
    }
    
    .info-card.highlight {
        background: rgba(59, 130, 246, 0.08);
        border: 1px solid rgba(59, 130, 246, 0.2);
    }
    
    /* ===== LOADING OVERLAY ===== */
    .loading-overlay {
        background: #1e293b;
        border-radius: 12px;
        padding: 2.5rem;
        text-align: center;
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    
    .loading-spinner {
        width: 48px;
        height: 48px;
        border: 3px solid rgba(59, 130, 246, 0.2);
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 1.25rem auto;
    }
    
    @keyframes spin {
        100% { transform: rotate(360deg); }
    }
    
    .loading-text {
        color: #f1f5f9;
        font-size: 1rem;
        font-weight: 500;
        margin-bottom: 0.5rem;
    }
    
    .loading-subtext {
        color: #64748b;
        font-size: 0.875rem;
    }
    
    .progress-steps {
        display: flex;
        justify-content: center;
        gap: 0.5rem;
        margin-top: 1.25rem;
    }
    
    .progress-step {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: rgba(148, 163, 184, 0.3);
        transition: all 0.3s ease;
    }
    
    .progress-step.active {
        background: #3b82f6;
    }
    
    .progress-step.completed {
        background: #10b981;
    }
    
    /* ===== BUTTONS ===== */
    .stButton > button {
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 0.75rem 1.5rem;
        font-weight: 500;
        font-size: 0.95rem;
        transition: all 0.2s ease;
    }
    
    .stButton > button:hover {
        background: #2563eb;
        transform: translateY(-1px);
    }
    
    .stButton > button:active {
        transform: translateY(0);
    }
    
    /* Download buttons */
    .stDownloadButton > button {
        background: #10b981;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 0.75rem 1.5rem;
        font-weight: 500;
    }
    
    .stDownloadButton > button:hover {
        background: #059669;
    }
    
    /* Fix button styling */
    .fix-btn {
        background: #10b981 !important;
    }
    
    /* ===== SIDEBAR ===== */
    [data-testid="stSidebar"] {
        background: #1e293b;
        border-right: 1px solid rgba(255, 255, 255, 0.08);
    }
    
    [data-testid="stSidebar"] [data-testid="stMarkdownContainer"] {
        color: #e2e8f0;
    }
    
    [data-testid="stSidebar"] .stRadio > label {
        color: #cbd5e1 !important;
        font-size: 0.875rem;
        font-weight: 500;
    }

    [data-testid="stSidebar"] .stMarkdown {
        font-size: 0.875rem;
    }

    [data-testid="stSidebar"] .stMarkdown p {
        font-size: 0.875rem;
        line-height: 1.6;
    }

    /* Sidebar title */
    [data-testid="stSidebar"] h1, 
    [data-testid="stSidebar"] h2, 
    [data-testid="stSidebar"] h3 {
        color: #f1f5f9;
        font-weight: 600;
    }

    /* Sidebar sliders */
    [data-testid="stSidebar"] [data-testid="stSlider"] {
        padding: 0.5rem 0;
    }

    [data-testid="stSidebar"] [data-testid="stSlider"] label {
        color: #e2e8f0 !important;
        font-size: 0.875rem !important;
        font-weight: 500 !important;
    }

    [data-testid="stSidebar"] [data-testid="stSlider"] [role="slider"] {
        background: #3b82f6;
        border: none;
    }

    [data-testid="stSidebar"] [data-testid="stSlider"] [data-baseweb="slider"] > div > div {
        background: #3b82f6;
        height: 4px;
        border-radius: 2px;
    }

    [data-testid="stSidebar"] [data-testid="stSlider"] [data-baseweb="slider"] > div {
        height: 4px;
        border-radius: 2px;
        background: rgba(148, 163, 184, 0.2);
    }

    /* Sidebar section dividers */
    [data-testid="stSidebar"] hr {
        margin: 1.5rem 0;
        border-color: rgba(255, 255, 255, 0.08);
    }
    
    /* ===== EXPANDERS ===== */
    .streamlit-expanderHeader {
        font-weight: 500;
        font-size: 0.95rem;
        color: #f1f5f9;
        background: transparent;
    }
    
    /* ===== FILE UPLOADER ===== */
    [data-testid="stFileUploader"] {
        background: transparent;
    }
    
    [data-testid="stFileUploader"] > div {
        background: #1e293b;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
    }
    
    /* ===== SUGGESTION CARDS ===== */
    .suggestion-card {
        background: #1e293b;
        border-radius: 10px;
        padding: 1rem 1.25rem;
        margin-bottom: 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.08);
        transition: all 0.2s ease;
    }
    
    .suggestion-card:hover {
        border-color: rgba(59, 130, 246, 0.3);
        transform: translateX(3px);
    }
    
    .suggestion-card.applied {
        background: rgba(16, 185, 129, 0.08);
        border-color: rgba(16, 185, 129, 0.2);
    }
    
    /* Text colors */
    .text-muted { color: #64748b; }
    .text-white { color: #f1f5f9; }
    .text-success { color: #10b981; }
    .text-danger { color: #ef4444; }
    .text-primary { color: #3b82f6; }
    
    /* Progress bar */
    .stProgress > div {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 4px;
    }
    
    .stProgress > div > div {
        background: #3b82f6;
        border-radius: 4px;
    }
    
    /* Divider */
    hr {
        margin: 2rem 0;
        border: none;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    
    /* Results Summary Card */
    .results-summary {
        background: rgba(59, 130, 246, 0.08);
        border: 1px solid rgba(59, 130, 246, 0.2);
        border-radius: 10px;
        padding: 1.25rem;
        margin-bottom: 1.25rem;
    }
    
    /* Tabs styling */
    .stTabs [data-baseweb="tab-list"] {
        gap: 0.5rem;
        background: transparent;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    
    .stTabs [data-baseweb="tab"] {
        border-radius: 6px 6px 0 0;
        color: #94a3b8;
        padding: 0.625rem 1.25rem;
        background: transparent;
        border-bottom: 2px solid transparent;
    }
    
    .stTabs [aria-selected="true"] {
        background: transparent;
        color: #3b82f6;
        border-bottom-color: #3b82f6;
    }
</style>
""",
            unsafe_allow_html=True)

# ============== HEADER ==============

st.markdown("""
<div class="main-header">
    <div class="header-content">
        <div>
            <h1>UniSlot</h1>
            <p>Smart Course Scheduling with Clash Optimization</p>
        </div>
    </div>
</div>
""",
            unsafe_allow_html=True)

# ============== SIDEBAR ==============

# Default values for settings
parallel_cap = 11
time_limit = 180
use_greedy = False
fix_time_limit = 120

with st.sidebar:
    st.markdown(f"""
    <div style="margin-bottom: 1.5rem;">
        <h3 style="font-size: 1.1rem; font-weight: 600; color: #f1f5f9; margin: 0 0 0.25rem 0;">Settings</h3>
        <p style="font-size: 0.813rem; color: #94a3b8; margin: 0;">Configure scheduling options</p>
    </div>
    """,
                unsafe_allow_html=True)

    # Mode selector
    st.markdown(
        "<p style='font-size: 0.813rem; font-weight: 500; color: #94a3b8; margin: 0 0 0.5rem 0; text-transform: uppercase; letter-spacing: 0.05em;'>Mode</p>",
        unsafe_allow_html=True)
    app_mode = st.radio(
        "Select operation mode", ["Generate Schedule", "Analyze Existing"],
        label_visibility="collapsed",
        help="Generate a new schedule or analyze an existing one for clashes")

    st.markdown("---")

    if app_mode == "Generate Schedule":
        st.markdown(
            "<p style='font-size: 0.813rem; font-weight: 500; color: #94a3b8; margin: 0 0 0.75rem 0; text-transform: uppercase; letter-spacing: 0.05em;'>Scheduling Options</p>",
            unsafe_allow_html=True)

        time_limit = st.slider(
            "Solver time limit (seconds)",
            min_value=30,
            max_value=300,
            value=180,
            help=
            "Maximum time the optimizer will spend finding the best schedule")

        use_greedy = st.checkbox("Use fast greedy solver only",
                                 value=False,
                                 help="Faster but may produce more clashes")
    else:
        st.markdown(
            "<p style='font-size: 0.813rem; font-weight: 500; color: #94a3b8; margin: 0 0 0.75rem 0; text-transform: uppercase; letter-spacing: 0.05em;'>Analysis Options</p>",
            unsafe_allow_html=True)
        fix_time_limit = st.slider(
            "Fix time limit (seconds)",
            min_value=30,
            max_value=300,
            value=120,
            help="Maximum time the optimizer will spend fixing the schedule")

    st.markdown("---")

    st.markdown(
        "<p style='font-size: 0.813rem; font-weight: 500; color: #94a3b8; margin: 0 0 0.75rem 0; text-transform: uppercase; letter-spacing: 0.05em;'>About</p>",
        unsafe_allow_html=True)
    if app_mode == "Generate Schedule":
        st.markdown("""
        <p style='color: #cbd5e1; font-size: 0.875rem; line-height: 1.6;'>
        UniSlot uses advanced optimization to schedule evening courses while <strong>minimizing student conflicts</strong>.
        </p>
        <p style='color: #94a3b8; font-size: 0.813rem; line-height: 1.5; margin-top: 0.75rem;'>
        1. Upload your enrollment data<br>
        2. Configure scheduling options<br>
        3. Run the optimizer<br>
        4. Download conflict-free schedules
        </p>
        """,
                    unsafe_allow_html=True)
    else:
        st.markdown("""
        <p style='color: #cbd5e1; font-size: 0.875rem; line-height: 1.6;'>
        <strong>Analyze Existing Schedules</strong> helps you find and fix clashes in pre-assigned schedules.
        </p>
        <p style='color: #94a3b8; font-size: 0.813rem; line-height: 1.5; margin-top: 0.75rem;'>
        1. Upload your existing schedule<br>
        2. Upload enrollment data<br>
        3. Find all student clashes<br>
        4. Fix schedule with optimizer
        </p>
        """,
                    unsafe_allow_html=True)

    st.markdown("---")
    st.markdown(
        "<p style='color: #475569; font-size: 0.75rem; text-align: center;'>UniSlot v0.1.0</p>",
        unsafe_allow_html=True)

# ============== MAIN CONTENT ==============

# Initialize upload variables
uploaded_file = None

if app_mode == "Generate Schedule":
    # ============== GENERATE SCHEDULE MODE ==============

    # Section 1: Upload
    st.markdown("""
    <div class="section-header">
        <div class="section-number">1</div>
        <h2>Upload Enrollment Data</h2>
    </div>
    """,
                unsafe_allow_html=True)

    uploaded_file = st.file_uploader(
        "Choose Excel file (.xlsx)",
        type=["xlsx", "xls"],
        help=
        "Upload enrollment data with columns: Program, Register Number, Student Name, Course Code, Course Title",
        label_visibility="collapsed",
        key="enrollment_file")

    if uploaded_file is None:
        st.markdown(f"""
        <div class="upload-area">
            <div class="upload-icon">{ICONS["upload"]}</div>
            <p style="font-size: 1.1rem; color: #cbd5e1; margin: 0;">
                <strong>Drag and drop</strong> your enrollment Excel file here
            </p>
            <p style="color: #64748b; margin: 0.5rem 0 0 0; font-size: 0.9rem;">Limit 200MB per file • XLSX, XLS</p>
        </div>
        """,
                    unsafe_allow_html=True)

    if uploaded_file is not None:
        # Show file info
        st.markdown(f"""
        <div style="display: flex; align-items: center; gap: 0.75rem; padding: 1rem; background: rgba(30, 41, 59, 0.5); border-radius: 10px; margin-bottom: 1rem;">
            <span style="color: #94a3b8;">{ICONS["file"]}</span>
            <span style="color: #f1f5f9; font-weight: 500;">{uploaded_file.name}</span>
            <span style="color: #64748b; font-size: 0.85rem;">{uploaded_file.size / 1024:.1f}KB</span>
        </div>
        """,
                    unsafe_allow_html=True)

        # Save to temp file
        with NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
            tmp.write(uploaded_file.getvalue())
            tmp_path = Path(tmp.name)

        # Loading overlay for validation
        loading_placeholder = st.empty()
        loading_placeholder.markdown("""
        <div class="loading-overlay">
            <div class="loading-spinner"></div>
            <div class="loading-text">Validating Data</div>
            <div class="loading-subtext">Processing your enrollment file...</div>
        </div>
        """,
                                     unsafe_allow_html=True)

        # Load and validate
        students, courses, rows, validation = load_and_validate(tmp_path)
        loading_placeholder.empty()

        # Section 2: Validation Results
        st.markdown("""
        <div class="section-header">
            <div class="section-number">2</div>
            <h2>Data Validation</h2>
        </div>
        """,
                    unsafe_allow_html=True)

        # Metrics row
        col1, col2, col3, col4, col5 = st.columns(5)

        with col1:
            st.markdown(f"""
            <div class="metric-container">
                <div class="metric-label">Total Rows</div>
                <div class="metric-value">{validation.total_rows:,}</div>
            </div>
            """,
                        unsafe_allow_html=True)

        with col2:
            st.markdown(f"""
            <div class="metric-container">
                <div class="metric-label">Valid Rows</div>
                <div class="metric-value success">{validation.valid_rows:,}</div>
            </div>
            """,
                        unsafe_allow_html=True)

        with col3:
            st.markdown(f"""
            <div class="metric-container">
                <div class="metric-label">Unique Students</div>
                <div class="metric-value primary">{len(students):,}</div>
            </div>
            """,
                        unsafe_allow_html=True)

        with col4:
            st.markdown(f"""
            <div class="metric-container">
                <div class="metric-label">Unique Courses</div>
                <div class="metric-value primary">{len(courses):,}</div>
            </div>
            """,
                        unsafe_allow_html=True)

        with col5:
            status_class = "success" if validation.is_valid else "danger"
            status_icon = ICONS["check"] if validation.is_valid else ICONS[
                "alert"]
            status_text = "Valid" if validation.is_valid else "Invalid"
            st.markdown(f"""
            <div class="metric-container">
                <div class="metric-label">Status</div>
                <div class="status-badge {status_class}"><span style="display: flex;">{status_icon}</span> {status_text}</div>
            </div>
            """,
                        unsafe_allow_html=True)

        # Errors and warnings
        if validation.errors:
            with st.expander(f"Errors ({len(validation.errors)})",
                             expanded=True):
                for err in validation.errors[:20]:
                    st.error(f"Row {err.row_number}: {err.message}" if err.
                             row_number else err.message)
                if len(validation.errors) > 20:
                    st.warning(
                        f"... and {len(validation.errors) - 20} more errors")

        if validation.warnings:
            with st.expander(f"Warnings ({len(validation.warnings)})"):
                for warn in validation.warnings[:20]:
                    st.warning(warn.message)

        # Run scheduler button
        if validation.is_valid:
            st.markdown("<br>", unsafe_allow_html=True)

            col_btn1, col_btn2, col_btn3 = st.columns([1, 2, 1])
            with col_btn2:
                run_scheduler_btn = st.button("Run Scheduler",
                                              type="primary",
                                              use_container_width=True)

            # Generate a unique key for this file upload to invalidate old results
            file_key = f"{uploaded_file.name}_{uploaded_file.size}"

            if run_scheduler_btn:
                # Section 3: Processing with loading overlay
                st.markdown("""
                <div class="section-header">
                    <div class="section-number">3</div>
                    <h2>Processing</h2>
                </div>
                """,
                            unsafe_allow_html=True)

                # Create a container for the loading overlay
                processing_container = st.container()

                with processing_container:
                    # Progress tracking with beautiful overlay
                    progress_placeholder = st.empty()

                    def show_loading(step: int,
                                     total: int,
                                     title: str,
                                     subtitle: str,
                                     countdown: str = ""):
                        steps_html = "".join([
                            f'<div class="progress-step {"completed" if i < step else "active" if i == step else ""}"></div>'
                            for i in range(total)
                        ])
                        countdown_html = f'<div style="font-size: 1.5rem; font-weight: 700; color: #3b82f6; margin: 0.5rem 0;">{countdown}</div>' if countdown else ""
                        progress_placeholder.markdown(f"""
                        <div class="loading-overlay">
                            <div class="loading-spinner"></div>
                            <div class="loading-text">{title}</div>
                            {countdown_html}
                            <div class="loading-subtext">{subtitle}</div>
                            <div class="progress-steps">{steps_html}</div>
                        </div>
                        """,
                                                      unsafe_allow_html=True)

                    # Step 1: Section splits
                    show_loading(0, 6, "Computing Sections",
                                 "Calculating optimal section splits...")
                    course_sections = compute_section_splits(courses,
                                                             max_capacity=65)

                    # Step 2: Student assignment
                    show_loading(1, 6, "Assigning Students",
                                 "Distributing students to sections...")
                    course_sections = assign_students_to_sections(
                        students, course_sections, rows)

                    # Step 3: Conflict graph
                    show_loading(2, 6, "Building Conflict Graph",
                                 "Analyzing course overlaps...")
                    conflict_graph = build_conflict_graph(
                        students, course_sections)

                    # Step 4: Faculty constraints
                    show_loading(3, 6, "Processing Constraints",
                                 "Extracting faculty availability...")
                    faculty_constraints = extract_faculty_constraints(
                        course_sections)

                    # Stats
                    total_sections = sum(
                        len(s) for s in course_sections.values())
                    total_edges = len(conflict_graph.edges)

                    # Step 5: Optimization with countdown timer
                    # Run scheduler in background thread with countdown
                    with concurrent.futures.ThreadPoolExecutor(
                            max_workers=1) as executor:
                        future = executor.submit(
                            run_scheduler,
                            course_sections,
                            conflict_graph,
                            faculty_constraints,
                            time_limit_seconds=time_limit,
                            use_greedy_only=use_greedy,
                        )

                        start_time = time.time()
                        # Show countdown while waiting
                        while not future.done():
                            elapsed = time.time() - start_time
                            remaining = max(0, time_limit - elapsed)
                            mins = int(remaining // 60)
                            secs = int(remaining % 60)
                            countdown_str = f"{mins}:{secs:02d}" if mins > 0 else f"{secs}s"

                            show_loading(
                                4,
                                6,
                                "Running Optimizer",
                                f"Scheduling {total_sections} sections with {total_edges} conflicts...",
                                countdown=countdown_str)
                            time.sleep(0.5)  # Update every 0.5 seconds

                        result = future.result()

                    # Step 6: Report generation
                    show_loading(5, 6, "Generating Reports",
                                 "Building schedule and clash analysis...")
                    schedule = build_schedule(course_sections, result)
                    clash_report = compute_clash_report(
                        students, course_sections, result)
                    schedule.total_clashes = clash_report.students_with_clashes

                    # Export to temp directory
                    output_dir = Path("/tmp/unislot_output")
                    schedule_path, clash_path = export_all(
                        schedule, clash_report, output_dir)

                    # Read file data for download buttons
                    with open(schedule_path, "rb") as f:
                        schedule_data = f.read()
                    with open(clash_path, "rb") as f:
                        clash_data = f.read()

                    # Store everything in session state with file key
                    st.session_state["schedule_result"] = {
                        "file_key": file_key,
                        "schedule": schedule,
                        "clash_report": clash_report,
                        "result": result,
                        "schedule_data": schedule_data,
                        "clash_data": clash_data,
                    }

                    time.sleep(0.3)
                    progress_placeholder.empty()

            # Display results from session state
            if ("schedule_result" in st.session_state
                    and st.session_state["schedule_result"].get("file_key")
                    == file_key):

                stored = st.session_state["schedule_result"]
                schedule = stored["schedule"]
                clash_report = stored["clash_report"]
                result = stored["result"]
                schedule_data = stored["schedule_data"]
                clash_data = stored["clash_data"]

                # Section: Results
                st.markdown("""
                <div class="section-header">
                    <div class="section-number">4</div>
                    <h2>Results</h2>
                </div>
                """,
                            unsafe_allow_html=True)

                # Success/Warning message
                if clash_report.students_with_clashes == 0:
                    st.markdown(f"""
                    <div class="info-card success">
                        <div style="display: flex; align-items: center; gap: 1rem;">
                            <span style="color: #10b981;">{ICONS["check"]}</span>
                            <div>
                                <strong style="font-size: 1.15rem; color: #10b981;">Perfect Schedule Generated</strong>
                                <p style="color: #6ee7b7; margin: 0.25rem 0 0 0; font-size: 0.9rem;">All students have conflict-free schedules.</p>
                            </div>
                        </div>
                    </div>
                    """,
                                unsafe_allow_html=True)
                else:
                    st.markdown(f"""
                    <div class="info-card warning">
                        <div style="display: flex; align-items: center; gap: 1rem;">
                            <span style="color: #f59e0b;">{ICONS["alert"]}</span>
                            <div>
                                <strong style="font-size: 1.15rem; color: #fbbf24;">{clash_report.students_with_clashes} students have clashes</strong>
                                <p style="color: #fcd34d; margin: 0.25rem 0 0 0; font-size: 0.9rem;">({clash_report.clash_percentage:.1f}% clash rate) - Check the Excel report for details</p>
                            </div>
                        </div>
                    </div>
                    """,
                                unsafe_allow_html=True)

                # Summary metrics row
                col1, col2, col3, col4 = st.columns(4)

                with col1:
                    st.markdown(f"""
                    <div class="metric-container">
                        <div class="metric-label">Solver Used</div>
                        <div class="metric-value primary">{result.solver_used.upper()}</div>
                    </div>
                    """,
                                unsafe_allow_html=True)

                with col2:
                    st.markdown(f"""
                    <div class="metric-container">
                        <div class="metric-label">Solve Time</div>
                        <div class="metric-value">{result.solver_time_seconds:.1f}s</div>
                    </div>
                    """,
                                unsafe_allow_html=True)

                with col3:
                    clash_class = "success" if clash_report.students_with_clashes == 0 else "danger"
                    st.markdown(f"""
                    <div class="metric-container">
                        <div class="metric-label">Students with Clashes</div>
                        <div class="metric-value {clash_class}">{clash_report.students_with_clashes}</div>
                    </div>
                    """,
                                unsafe_allow_html=True)

                with col4:
                    st.markdown(f"""
                    <div class="metric-container">
                        <div class="metric-label">Total Sections</div>
                        <div class="metric-value">{schedule.total_sections}</div>
                    </div>
                    """,
                                unsafe_allow_html=True)

                st.markdown("<br>", unsafe_allow_html=True)

                # Download section - prominently displayed
                st.markdown(f"""
                <div class="results-summary">
                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                        <span style="color: #3b82f6;">{ICONS["download"]}</span>
                        <span style="color: #f1f5f9; font-size: 1.1rem; font-weight: 600;">Download Results</span>
                    </div>
                    <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1rem;">
                        Your complete schedule and clash analysis are ready. The Excel files contain detailed breakdowns by day, program, and course.
                    </p>
                </div>
                """,
                            unsafe_allow_html=True)

                col1, col2, col3 = st.columns([1, 1, 1])

                with col1:
                    st.download_button(
                        "Download Schedule",
                        schedule_data,
                        file_name="schedule.xlsx",
                        mime=
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        use_container_width=True,
                        key="download_schedule")

                with col2:
                    st.download_button(
                        "Download Clash Report",
                        clash_data,
                        file_name="clash_report.xlsx",
                        mime=
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        use_container_width=True,
                        key="download_clash")

else:
    # ============== ANALYZE EXISTING SCHEDULE MODE ==============

    # Section 1: Upload Schedule
    st.markdown("""
    <div class="section-header">
        <div class="section-number">1</div>
        <h2>Upload Existing Schedule</h2>
    </div>
    """,
                unsafe_allow_html=True)

    st.markdown(f"""
    <div class="info-card">
        <p style="color: #cbd5e1; margin: 0;">
            Upload your faculty schedule file that contains student enrollments with day assignments.
        </p>
        <p style="color: #64748b; font-size: 0.85rem; margin: 0.5rem 0 0 0;">
            Expected columns: Register no, Student Name, Program, Course Code, DAY, etc.
        </p>
    </div>
    """,
                unsafe_allow_html=True)

    schedule_file = st.file_uploader(
        "Choose schedule Excel file (.xlsx)",
        type=["xlsx", "xls"],
        help=
        "Upload faculty schedule with student enrollments and day assignments",
        label_visibility="collapsed",
        key="schedule_file")

    # Optional: Additional enrollment file
    with st.expander("Upload additional enrollment data (optional)",
                     expanded=False):
        st.markdown("""
        <p style="color: #64748b; font-size: 0.85rem;">
        If your schedule file doesn't contain complete student enrollment data,
        you can upload a separate enrollment file here.
        </p>
        """,
                    unsafe_allow_html=True)

        enrollment_file = st.file_uploader(
            "Choose enrollment Excel file (.xlsx)",
            type=["xlsx", "xls"],
            help="Optional: Upload additional enrollment data",
            label_visibility="collapsed",
            key="analyze_enrollment_file")

    if schedule_file is not None:
        # Show file info
        st.markdown(f"""
        <div style="display: flex; align-items: center; gap: 0.75rem; padding: 1rem; background: rgba(30, 41, 59, 0.5); border-radius: 10px; margin-bottom: 1rem;">
            <span style="color: #94a3b8;">{ICONS["file"]}</span>
            <span style="color: #f1f5f9; font-weight: 500;">{schedule_file.name}</span>
            <span style="color: #64748b; font-size: 0.85rem;">{schedule_file.size / 1024:.1f}KB</span>
        </div>
        """,
                    unsafe_allow_html=True)

        # Loading overlay
        loading_placeholder = st.empty()
        loading_placeholder.markdown("""
        <div class="loading-overlay">
            <div class="loading-spinner"></div>
            <div class="loading-text">Loading Schedule</div>
            <div class="loading-subtext">Parsing your schedule file...</div>
        </div>
        """,
                                     unsafe_allow_html=True)

        # Save schedule to temp file
        with NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
            tmp.write(schedule_file.getvalue())
            schedule_tmp_path = Path(tmp.name)

        # Parse schedule (now includes student data)
        presorted, schedule_validation = parse_presorted_schedule(
            schedule_tmp_path)

        # Check if we have embedded student data
        has_embedded_students = (presorted is not None
                                 and presorted.students is not None
                                 and len(presorted.students) > 0)

        # Parse additional enrollment if provided
        students = {}
        enrollment_validation = None
        if enrollment_file is not None:
            with NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
                tmp.write(enrollment_file.getvalue())
                enrollment_tmp_path = Path(tmp.name)

            students, courses, rows, enrollment_validation = load_and_validate(
                enrollment_tmp_path)

        loading_placeholder.empty()

        # Section 2: Analysis Results
        st.markdown("""
        <div class="section-header">
            <div class="section-number">2</div>
            <h2>Clash Analysis</h2>
        </div>
        """,
                    unsafe_allow_html=True)

        if not schedule_validation.is_valid:
            st.markdown(f"""
            <div class="info-card" style="border-color: rgba(239, 68, 68, 0.3);">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <span style="color: #ef4444;">{ICONS["alert"]}</span>
                    <span style="color: #ef4444; font-weight: 600;">Could not parse schedule file</span>
                </div>
            </div>
            """,
                        unsafe_allow_html=True)
            for err in schedule_validation.errors[:5]:
                st.error(f"Error: {err.message}")
        elif enrollment_validation is not None and not enrollment_validation.is_valid:
            st.markdown(f"""
            <div class="info-card" style="border-color: rgba(239, 68, 68, 0.3);">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <span style="color: #ef4444;">{ICONS["alert"]}</span>
                    <span style="color: #ef4444; font-weight: 600;">Could not parse enrollment file</span>
                </div>
            </div>
            """,
                        unsafe_allow_html=True)
            for err in enrollment_validation.errors[:5]:
                st.error(f"Error: {err.message}")
        elif presorted is not None:
            # Determine student count for display
            if students:
                student_count = len(students)
                student_source = "from enrollment file"
            elif has_embedded_students and presorted.students is not None:
                student_count = len(presorted.students)
                student_source = "from schedule file"
            else:
                st.markdown(f"""
                <div class="info-card warning">
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <span style="color: #f59e0b;">{ICONS["alert"]}</span>
                        <span style="color: #fbbf24; font-weight: 600;">No student data found. Please upload a file with student enrollment information.</span>
                    </div>
                </div>
                """,
                            unsafe_allow_html=True)
                student_count = 0
                student_source = ""

            if student_count > 0:
                # Show data source info
                st.markdown(f"""
                <div class="info-card">
                    <p style="color: #cbd5e1; margin: 0;">
                        Found <strong style="color: #3b82f6;">{student_count:,}</strong> students ({student_source}) 
                        and <strong style="color: #3b82f6;">{len(presorted.course_day_map)}</strong> courses
                    </p>
                </div>
                """,
                            unsafe_allow_html=True)

                # Analyze with loading
                analysis_loading = st.empty()
                analysis_loading.markdown("""
                <div class="loading-overlay">
                    <div class="loading-spinner"></div>
                    <div class="loading-text">Analyzing Clashes</div>
                    <div class="loading-subtext">Scanning for scheduling conflicts...</div>
                </div>
                """,
                                          unsafe_allow_html=True)

                analysis = analyze_presorted_schedule_clashes(
                    students if students else None, presorted)

                analysis_loading.empty()

                # Summary metrics
                col1, col2, col3, col4 = st.columns(4)

                with col1:
                    st.markdown(f"""
                    <div class="metric-container">
                        <div class="metric-label">Total Clashes</div>
                        <div class="metric-value danger">{analysis.total_clashes}</div>
                    </div>
                    """,
                                unsafe_allow_html=True)

                with col2:
                    st.markdown(f"""
                    <div class="metric-container">
                        <div class="metric-label">Students Affected</div>
                        <div class="metric-value danger">{analysis.students_affected}</div>
                    </div>
                    """,
                                unsafe_allow_html=True)

                with col3:
                    st.markdown(f"""
                    <div class="metric-container">
                        <div class="metric-label">Total Students</div>
                        <div class="metric-value primary">{student_count:,}</div>
                    </div>
                    """,
                                unsafe_allow_html=True)

                with col4:
                    clash_rate = (analysis.students_affected / student_count *
                                  100) if student_count > 0 else 0
                    st.markdown(f"""
                    <div class="metric-container">
                        <div class="metric-label">Clash Rate</div>
                        <div class="metric-value">{clash_rate:.1f}%</div>
                    </div>
                    """,
                                unsafe_allow_html=True)

                st.markdown("<br>", unsafe_allow_html=True)

                st.markdown(f"""
                <div class="section-header">
                    <div class="section-number">3</div>
                    <h2>Fix Schedule</h2>
                </div>
                """,
                            unsafe_allow_html=True)

                st.markdown(f"""
                <div class="info-card">
                    <p style="color: #cbd5e1; margin: 0;">
                        Run UniSlot to fix clashes with <strong style="color: #10b981;">minimum changes</strong>.
                        The optimizer prioritizes fewer clashes, then fewer moved courses.
                    </p>
                </div>
                """,
                            unsafe_allow_html=True)

                file_key = f"analysis_{schedule_file.name}_{schedule_file.size}"
                if "fixed_result" not in st.session_state or st.session_state[
                        "fixed_result"].get("file_key") != file_key:
                    st.session_state["fixed_result"] = {
                        "file_key": file_key,
                        "fixed_course_day_map": None,
                        "fixed_analysis": None,
                        "applied_fixes": [],
                    }

                if st.button("Fix Schedule",
                             key="fix_schedule",
                             use_container_width=True):
                    fix_loading = st.empty()
                    fix_loading.markdown("""
                    <div class="loading-overlay">
                        <div class="loading-spinner"></div>
                        <div class="loading-text">Fixing Schedule</div>
                        <div class="loading-subtext">Optimizing for minimum clashes...</div>
                    </div>
                    """,
                                         unsafe_allow_html=True)

                    fixed_course_day_map, fixed_analysis = optimize_presorted_schedule(
                        students if students else {},
                        presorted,
                        time_limit_seconds=fix_time_limit)

                    fix_loading.empty()

                    applied_fixes_list = []
                    original_map = presorted.course_day_map
                    for course_code, new_day in sorted(
                            fixed_course_day_map.items()):
                        original_day = original_map.get(course_code)
                        if original_day and new_day != original_day:
                            applied_fixes_list.append({
                                "course_code": course_code,
                                "original_day": original_day,
                                "new_day": new_day,
                            })

                    st.session_state["fixed_result"] = {
                        "file_key": file_key,
                        "fixed_course_day_map": fixed_course_day_map,
                        "fixed_analysis": fixed_analysis,
                        "applied_fixes": applied_fixes_list,
                    }

                fixed_result = st.session_state.get("fixed_result")
                fixed_analysis = fixed_result.get("fixed_analysis")
                applied_fixes_list = fixed_result.get("applied_fixes", [])

                if fixed_analysis:
                    st.markdown("<br>", unsafe_allow_html=True)
                    st.markdown(f"""
                    <div class="info-card highlight">
                        <div style="display: flex; align-items: center; gap: 1rem;">
                            <span style="color: #10b981;">{ICONS["check"]}</span>
                            <div>
                                <strong style="font-size: 1.1rem; color: #10b981;">Fix Completed</strong>
                                <p style="color: #6ee7b7; margin: 0.25rem 0 0 0; font-size: 0.9rem;">Applied {len(applied_fixes_list)} course changes.</p>
                            </div>
                        </div>
                    </div>
                    """,
                                unsafe_allow_html=True)

                st.markdown("<br>", unsafe_allow_html=True)
                st.markdown(f"""
                <div class="results-summary">
                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                        <span style="color: #3b82f6;">{ICONS["download"]}</span>
                        <span style="color: #f1f5f9; font-size: 1.1rem; font-weight: 600;">Export Options</span>
                    </div>
                    <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1rem;">
                        Download the clash analysis or the fixed schedule with changes highlighted in green.
                    </p>
                </div>
                """,
                            unsafe_allow_html=True)

                from unislot.models import ClashReport as CR, StudentClashReport, ClashStatus

                report_source = fixed_analysis if fixed_analysis else analysis
                clash_reports = []
                for clash in report_source.clash_details:
                    from unislot.models import Day
                    report = StudentClashReport(
                        register_number=clash["student_id"],
                        student_name=clash["student_name"],
                        program=clash["program"],
                        enrolled_courses=[
                            clash["course_a"], clash["course_b"]
                        ],
                        status=ClashStatus.RED,
                        clashing_courses=[(clash["course_a"],
                                           clash["course_b"])],
                        clashing_day=Day(clash["day"]),
                    )
                    clash_reports.append(report)

                output_dir = Path("/tmp/unislot_analysis")
                output_dir.mkdir(parents=True, exist_ok=True)

                full_report = CR(
                    reports=clash_reports,
                    total_students=student_count,
                    students_with_clashes=report_source.students_affected,
                    clash_free_students=student_count -
                    report_source.students_affected,
                    clash_percentage=(report_source.students_affected /
                                      student_count *
                                      100) if student_count > 0 else 0,
                )

                clash_path = export_clash_report_xlsx(
                    full_report, output_dir / "clash_analysis.xlsx")

                fixed_path = None
                if presorted is not None:
                    fixed_path = export_fixed_schedule_xlsx(
                        presorted, applied_fixes_list,
                        output_dir / "fixed_schedule.xlsx")

                col1, col2 = st.columns(2)
                with col1:
                    with open(clash_path, "rb") as f:
                        st.download_button(
                            "Download Clash Analysis",
                            f.read(),
                            file_name="clash_analysis.xlsx",
                            mime=
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            use_container_width=True,
                            key="download_clash_analysis")

                with col2:
                    if fixed_path:
                        with open(fixed_path, "rb") as f:
                            st.download_button(
                                f"Download Fixed Schedule ({len(applied_fixes_list)} changes)",
                                f.read(),
                                file_name="fixed_schedule.xlsx",
                                mime=
                                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                use_container_width=True,
                                key="download_fixed_schedule")
                    else:
                        st.markdown("""
                        <div style="background: rgba(30, 41, 59, 0.5); border-radius: 8px; padding: 1rem; text-align: center; border: 1px dashed #475569;">
                            <p style="color: #64748b; margin: 0; font-size: 0.9rem;">Run Fix Schedule to enable export</p>
                        </div>
                        """,
                                    unsafe_allow_html=True)

    elif schedule_file is None:
        st.markdown(f"""
        <div class="upload-area">
            <div class="upload-icon">{ICONS["upload"]}</div>
            <p style="font-size: 1.1rem; color: #cbd5e1; margin: 0;">
                Upload a faculty schedule file to analyze clashes
            </p>
            <p style="color: #64748b; margin: 0.5rem 0 0 0; font-size: 0.9rem;">AlreadySortedByFaculty.xlsx or similar</p>
        </div>
        """,
                    unsafe_allow_html=True)

# Footer
st.markdown("---")
st.markdown("""
<div style="text-align: center; color: #475569; padding: 1rem 0;">
    <p style="margin: 0; font-size: 0.85rem;">UniSlot v0.1.0 • Built with OR-Tools, FastAPI & Streamlit</p>
    <p style="margin: 0.25rem 0 0 0; font-size: 0.75rem; color: #64748b;">Smart Course Scheduling with Clash Optimization</p>
</div>
""",
            unsafe_allow_html=True)
