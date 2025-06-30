/* Copyright 2023 edonyzpc */

import { App, requestUrl, normalizePath } from 'obsidian';
import JSZip from 'jszip';

export const TEST_TOKEN = "personal-assistant";

export const icons: Record<string, string> = {
    PluginAST: `<svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="100" height="100" viewBox="0 0 172 172" style=" fill:#000000;"><g fill="none" fill-rule="nonzero" stroke="none" stroke-width="1" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" stroke-dasharray="" stroke-dashoffset="0" font-family="none" font-weight="none" font-size="none" text-anchor="none" style="mix-blend-mode: normal"><path d="M0,172v-172h172v172z" fill="none"></path><g fill="currentColor"><path d="M53.75,21.5c-8.27246,0 -14.86523,5.20703 -18.39257,12.09375c-8.39844,1.76368 -15.91504,6.84473 -19.31641,15.03321c-6.50879,15.5371 -16.04102,41.53027 -16.04102,64.24804c0,20.70215 16.92285,37.625 37.625,37.625c14.90723,0 27.75683,-8.86035 33.84571,-21.5h29.05859c6.08886,12.63965 18.93847,21.5 33.8457,21.5c20.70215,0 37.625,-16.92285 37.625,-37.625c0,-8.44043 -2.60351,-19.44239 -5.87891,-30.90625c-3.31739,-11.50585 -7.39062,-23.26367 -10.58203,-32.08203c-3.10742,-8.44043 -10.41406,-13.85742 -18.77051,-15.99902c-3.48534,-7.05469 -10.12011,-12.3877 -18.51855,-12.3877c-7.68457,0 -13.73145,4.61915 -17.51074,10.75h-29.47852c-3.77929,-6.13085 -9.82617,-10.75 -17.51074,-10.75zM53.75,32.25c4.70313,0 8.6084,3.02344 10.07813,7.18067l1.25977,3.56933h41.82422l1.25976,-3.56933c1.46973,-4.15723 5.375,-7.18067 10.07813,-7.18067c4.8291,0 8.77636,3.19141 10.16211,7.5166l1.00781,3.14942l3.27539,0.50391c5.87891,0.92382 10.70801,4.61914 12.76563,10.1621c2.81348,7.72656 6.21484,17.7627 9.19629,27.71484c-5.87891,-3.77929 -12.80761,-6.04687 -20.28223,-6.04687c-14.90723,0 -27.75683,8.86035 -33.8457,21.5h-29.05859c-6.08888,-12.63965 -18.93848,-21.5 -33.84571,-21.5c-8.18848,0 -15.74707,2.72949 -21.91992,7.22266c3.06543,-11.21192 7.01269,-21.87793 10.24609,-29.68848c2.22558,-5.375 7.22266,-8.86034 13.10156,-9.49023l3.44335,-0.37793l1.0918,-3.2754c1.42773,-4.2832 5.375,-7.39062 10.1621,-7.39062zM37.625,86c14.90723,0 26.875,11.96777 26.875,26.875c0,14.90723 -11.96777,26.875 -26.875,26.875c-14.90723,0 -26.875,-11.96777 -26.875,-26.875c0,-14.90723 11.96777,-26.875 26.875,-26.875zM134.375,86c14.90723,0 26.875,11.96777 26.875,26.875c0,14.90723 -11.96777,26.875 -26.875,26.875c-14.90723,0 -26.875,-11.96777 -26.875,-26.875c0,-14.90723 11.96777,-26.875 26.875,-26.875zM74.7041,107.5h22.59179c-0.25195,1.76368 -0.5459,3.52734 -0.5459,5.375c0,1.84766 0.29395,3.61133 0.5459,5.375h-22.59179c0.25195,-1.76367 0.5459,-3.52734 0.5459,-5.375c0,-1.84766 -0.29395,-3.61132 -0.5459,-5.375z"></path></g></g></svg>`,
    //PluginAST_STATUSBAR: `<svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="100" height="100" viewBox="0 0 172 172"><g fill="currentColor" fill-rule="nonzero" stroke="none" stroke-width="1" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" stroke-dasharray="" stroke-dashoffset="0" font-family="none" font-weight="none" font-size="none" text-anchor="none" style="mix-blend-mode: normal"><path d="M0,172v-172h172v172z" fill="none"></path><g fill="currentColor"><path d="M53.75,21.5c-8.27246,0 -14.86523,5.20703 -18.39257,12.09375c-8.39844,1.76368 -15.91504,6.84473 -19.31641,15.03321c-6.50879,15.5371 -16.04102,41.53027 -16.04102,64.24804c0,20.70215 16.92285,37.625 37.625,37.625c14.90723,0 27.75683,-8.86035 33.84571,-21.5h29.05859c6.08886,12.63965 18.93847,21.5 33.8457,21.5c20.70215,0 37.625,-16.92285 37.625,-37.625c0,-8.44043 -2.60351,-19.44239 -5.87891,-30.90625c-3.31739,-11.50585 -7.39062,-23.26367 -10.58203,-32.08203c-3.10742,-8.44043 -10.41406,-13.85742 -18.77051,-15.99902c-3.48534,-7.05469 -10.12011,-12.3877 -18.51855,-12.3877c-7.68457,0 -13.73145,4.61915 -17.51074,10.75h-29.47852c-3.77929,-6.13085 -9.82617,-10.75 -17.51074,-10.75zM53.75,32.25c4.70313,0 8.6084,3.02344 10.07813,7.18067l1.25977,3.56933h41.82422l1.25976,-3.56933c1.46973,-4.15723 5.375,-7.18067 10.07813,-7.18067c4.8291,0 8.77636,3.19141 10.16211,7.5166l1.00781,3.14942l3.27539,0.50391c5.87891,0.92382 10.70801,4.61914 12.76563,10.1621c2.81348,7.72656 6.21484,17.7627 9.19629,27.71484c-5.87891,-3.77929 -12.80761,-6.04687 -20.28223,-6.04687c-14.90723,0 -27.75683,8.86035 -33.8457,21.5h-29.05859c-6.08888,-12.63965 -18.93848,-21.5 -33.84571,-21.5c-8.18848,0 -15.74707,2.72949 -21.91992,7.22266c3.06543,-11.21192 7.01269,-21.87793 10.24609,-29.68848c2.22558,-5.375 7.22266,-8.86034 13.10156,-9.49023l3.44335,-0.37793l1.0918,-3.2754c1.42773,-4.2832 5.375,-7.39062 10.1621,-7.39062zM37.625,86c14.90723,0 26.875,11.96777 26.875,26.875c0,14.90723 -11.96777,26.875 -26.875,26.875c-14.90723,0 -26.875,-11.96777 -26.875,-26.875c0,-14.90723 11.96777,-26.875 26.875,-26.875zM134.375,86c14.90723,0 26.875,11.96777 26.875,26.875c0,14.90723 -11.96777,26.875 -26.875,26.875c-14.90723,0 -26.875,-11.96777 -26.875,-26.875c0,-14.90723 11.96777,-26.875 26.875,-26.875zM74.7041,107.5h22.59179c-0.25195,1.76368 -0.5459,3.52734 -0.5459,5.375c0,1.84766 0.29395,3.61133 0.5459,5.375h-22.59179c0.25195,-1.76367 0.5459,-3.52734 0.5459,-5.375c0,-1.84766 -0.29395,-3.61132 -0.5459,-5.375z"></path></g></g></svg>`,
    PluginAST_STATUSBAR: `<svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="100" height="100" viewBox="0 0 172 172"><g fill="currentColor" fill-rule="nonzero" stroke="none" stroke-width="1" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" stroke-dasharray="" stroke-dashoffset="0" font-family="none" font-weight="none" font-size="none" text-anchor="none" style="mix-blend-mode: normal"><path d="M0,172v-172h172v172z" fill="none"></path><g id="svg-animate" fill="currentColor"><path d="M53.75,21.5c-8.27246,0 -14.86523,5.20703 -18.39257,12.09375c-8.39844,1.76368 -15.91504,6.84473 -19.31641,15.03321c-6.50879,15.5371 -16.04102,41.53027 -16.04102,64.24804c0,20.70215 16.92285,37.625 37.625,37.625c14.90723,0 27.75683,-8.86035 33.84571,-21.5h29.05859c6.08886,12.63965 18.93847,21.5 33.8457,21.5c20.70215,0 37.625,-16.92285 37.625,-37.625c0,-8.44043 -2.60351,-19.44239 -5.87891,-30.90625c-3.31739,-11.50585 -7.39062,-23.26367 -10.58203,-32.08203c-3.10742,-8.44043 -10.41406,-13.85742 -18.77051,-15.99902c-3.48534,-7.05469 -10.12011,-12.3877 -18.51855,-12.3877c-7.68457,0 -13.73145,4.61915 -17.51074,10.75h-29.47852c-3.77929,-6.13085 -9.82617,-10.75 -17.51074,-10.75zM53.75,32.25c4.70313,0 8.6084,3.02344 10.07813,7.18067l1.25977,3.56933h41.82422l1.25976,-3.56933c1.46973,-4.15723 5.375,-7.18067 10.07813,-7.18067c4.8291,0 8.77636,3.19141 10.16211,7.5166l1.00781,3.14942l3.27539,0.50391c5.87891,0.92382 10.70801,4.61914 12.76563,10.1621c2.81348,7.72656 6.21484,17.7627 9.19629,27.71484c-5.87891,-3.77929 -12.80761,-6.04687 -20.28223,-6.04687c-14.90723,0 -27.75683,8.86035 -33.8457,21.5h-29.05859c-6.08888,-12.63965 -18.93848,-21.5 -33.84571,-21.5c-8.18848,0 -15.74707,2.72949 -21.91992,7.22266c3.06543,-11.21192 7.01269,-21.87793 10.24609,-29.68848c2.22558,-5.375 7.22266,-8.86034 13.10156,-9.49023l3.44335,-0.37793l1.0918,-3.2754c1.42773,-4.2832 5.375,-7.39062 10.1621,-7.39062zM37.625,86c14.90723,0 26.875,11.96777 26.875,26.875c0,14.90723 -11.96777,26.875 -26.875,26.875c-14.90723,0 -26.875,-11.96777 -26.875,-26.875c0,-14.90723 11.96777,-26.875 26.875,-26.875zM134.375,86c14.90723,0 26.875,11.96777 26.875,26.875c0,14.90723 -11.96777,26.875 -26.875,26.875c-14.90723,0 -26.875,-11.96777 -26.875,-26.875c0,-14.90723 11.96777,-26.875 26.875,-26.875zM74.7041,107.5h22.59179c-0.25195,1.76368 -0.5459,3.52734 -0.5459,5.375c0,1.84766 0.29395,3.61133 0.5459,5.375h-22.59179c0.25195,-1.76367 0.5459,-3.52734 0.5459,-5.375c0,-1.84766 -0.29395,-3.61132 -0.5459,-5.375z"></path></g></g></svg>`,
    PluginAST_PREVIEW: `<svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="100" height="100" viewBox="0 0 172 172"><g fill="blue" fill-rule="nonzero" stroke="none" stroke-width="1" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" stroke-dasharray="5,5" stroke-dashoffset="0" font-family="none" font-weight="none" font-size="none" text-anchor="none" style="mix-blend-mode: normal"><path d="M0,172v-172h172v172z" fill="none"></path><g id="svg-animate" fill="#2fcc70ee" fill-rule="nonzero"><path d="M53.75,21.5c-8.27246,0 -14.86523,5.20703 -18.39257,12.09375c-8.39844,1.76368 -15.91504,6.84473 -19.31641,15.03321c-6.50879,15.5371 -16.04102,41.53027 -16.04102,64.24804c0,20.70215 16.92285,37.625 37.625,37.625c14.90723,0 27.75683,-8.86035 33.84571,-21.5h29.05859c6.08886,12.63965 18.93847,21.5 33.8457,21.5c20.70215,0 37.625,-16.92285 37.625,-37.625c0,-8.44043 -2.60351,-19.44239 -5.87891,-30.90625c-3.31739,-11.50585 -7.39062,-23.26367 -10.58203,-32.08203c-3.10742,-8.44043 -10.41406,-13.85742 -18.77051,-15.99902c-3.48534,-7.05469 -10.12011,-12.3877 -18.51855,-12.3877c-7.68457,0 -13.73145,4.61915 -17.51074,10.75h-29.47852c-3.77929,-6.13085 -9.82617,-10.75 -17.51074,-10.75zM53.75,32.25c4.70313,0 8.6084,3.02344 10.07813,7.18067l1.25977,3.56933h41.82422l1.25976,-3.56933c1.46973,-4.15723 5.375,-7.18067 10.07813,-7.18067c4.8291,0 8.77636,3.19141 10.16211,7.5166l1.00781,3.14942l3.27539,0.50391c5.87891,0.92382 10.70801,4.61914 12.76563,10.1621c2.81348,7.72656 6.21484,17.7627 9.19629,27.71484c-5.87891,-3.77929 -12.80761,-6.04687 -20.28223,-6.04687c-14.90723,0 -27.75683,8.86035 -33.8457,21.5h-29.05859c-6.08888,-12.63965 -18.93848,-21.5 -33.84571,-21.5c-8.18848,0 -15.74707,2.72949 -21.91992,7.22266c3.06543,-11.21192 7.01269,-21.87793 10.24609,-29.68848c2.22558,-5.375 7.22266,-8.86034 13.10156,-9.49023l3.44335,-0.37793l1.0918,-3.2754c1.42773,-4.2832 5.375,-7.39062 10.1621,-7.39062zM37.625,86c14.90723,0 26.875,11.96777 26.875,26.875c0,14.90723 -11.96777,26.875 -26.875,26.875c-14.90723,0 -26.875,-11.96777 -26.875,-26.875c0,-14.90723 11.96777,-26.875 26.875,-26.875zM134.375,86c14.90723,0 26.875,11.96777 26.875,26.875c0,14.90723 -11.96777,26.875 -26.875,26.875c-14.90723,0 -26.875,-11.96777 -26.875,-26.875c0,-14.90723 11.96777,-26.875 26.875,-26.875zM74.7041,107.5h22.59179c-0.25195,1.76368 -0.5459,3.52734 -0.5459,5.375c0,1.84766 0.29395,3.61133 0.5459,5.375h-22.59179c0.25195,-1.76367 0.5459,-3.52734 0.5459,-5.375c0,-1.84766 -0.29395,-3.61132 -0.5459,-5.375z"></path></g></g></svg>`,
    PluginAST_STAT: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bar-chart-3"><path d="M3 3v18h18"/><path stroke-width="3" stroke="green" d="M18 17V9"/><path stroke-width="3" stroke="red" d="M13 17V5"/><path stroke-width="3" stroke="goldenrod" d="M8 17v-3"/></svg>`,
    SWITCH_ON_STATUS: `<svg width="99px" height="99px" viewBox="0 0 24 24" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"><g fill="green" fill-rule="nonzero"><path d="M18.25,3 C19.7687831,3 21,4.23121694 21,5.75 L21,18.25 C21,19.7687831 19.7687831,21 18.25,21 L5.75,21 C4.23121694,21 3,19.7687831 3,18.25 L3,5.75 C3,4.23121694 4.23121694,3 5.75,3 L18.25,3 Z M18.25,4.5 L5.75,4.5 C5.05964406,4.5 4.5,5.05964406 4.5,5.75 L4.5,18.25 C4.5,18.9403559 5.05964406,19.5 5.75,19.5 L18.25,19.5 C18.9403559,19.5 19.5,18.9403559 19.5,18.25 L19.5,5.75 C19.5,5.05964406 18.9403559,4.5 18.25,4.5 Z M10,14.4393398 L16.4696699,7.96966991 C16.7625631,7.6767767 17.2374369,7.6767767 17.5303301,7.96966991 C17.7965966,8.23593648 17.8208027,8.65260016 17.6029482,8.94621165 L17.5303301,9.03033009 L10.5303301,16.0303301 C10.2640635,16.2965966 9.84739984,16.3208027 9.55378835,16.1029482 L9.46966991,16.0303301 L6.46966991,13.0303301 C6.1767767,12.7374369 6.1767767,12.2625631 6.46966991,11.9696699 C6.73593648,11.7034034 7.15260016,11.6791973 7.44621165,11.8970518 L7.53033009,11.9696699 L10,14.4393398 L16.4696699,7.96966991 L10,14.4393398 Z"></path></g></g></svg>`,
    SWITCH_OFF_STATUS: `<svg width="99px" height="99px" viewBox="0 0 24 24" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"><g fill="red" fill-rule="nonzero"><path d="M5.75,3 L18.25,3 C19.7687831,3 21,4.23121694 21,5.75 L21,18.25 C21,19.7687831 19.7687831,21 18.25,21 L5.75,21 C4.23121694,21 3,19.7687831 3,18.25 L3,5.75 C3,4.23121694 4.23121694,3 5.75,3 Z M5.75,4.5 C5.05964406,4.5 4.5,5.05964406 4.5,5.75 L4.5,18.25 C4.5,18.9403559 5.05964406,19.5 5.75,19.5 L18.25,19.5 C18.9403559,19.5 19.5,18.9403559 19.5,18.25 L19.5,5.75 C19.5,5.05964406 18.9403559,4.5 18.25,4.5 L5.75,4.5 Z"></path></g></g></svg>`,
    PLUGIN_UPDATE_STATUS: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48"><path fill='red' d="M2,7H0V3C0,1.35,1.35,0,3,0H7V2H3c-.55,0-1,.45-1,1V7Zm0,14v-4H0v4c0,1.65,1.35,3,3,3H7v-2H3c-.55,0-1-.45-1-1Zm20,0c0,.55-.45,1-1,1h-4v2h4c1.65,0,3-1.35,3-3v-4h-2v4Zm-4-10.08v-.92h-4.33l-1.18-4.5h-.97l-1.18,4.5H6v.92l3.32,1.85-1.3,4.08,.72,.54,3.27-2.53,3.26,2.52,.75-.52-1.33-4.03,3.3-1.91ZM17,0V8l7-4L17,0Z"/></svg>`,
    PLUGIN_UPDATED_STATUS: `<svg xmlns="http://www.w3.org/2000/svg" width="99px" height="99px" viewBox="0 -960 960 960" width="48"><path fill="green" d="M229.911-160Q201-160 180.5-180.589q-20.5-20.588-20.5-49.5Q160-259 180.589-279.5q20.588-20.5 49.5-20.5Q259-300 279.5-279.411q20.5 20.588 20.5 49.5Q300-201 279.411-180.5q-20.588 20.5-49.5 20.5Zm335 0Q536-160 515.5-180.589q-20.5-20.588-20.5-49.5Q495-259 515.589-279.5q20.588-20.5 49.5-20.5Q594-300 614.5-279.411q20.5 20.588 20.5 49.5Q635-201 614.411-180.5q-20.588 20.5-49.5 20.5Zm-170-165Q366-325 345.5-345.589q-20.5-20.588-20.5-49.5Q325-424 345.589-444.5q20.588-20.5 49.5-20.5Q424-465 444.5-444.411q20.5 20.588 20.5 49.5Q465-366 444.411-345.5q-20.588 20.5-49.5 20.5Zm335 0Q701-325 680.5-345.589q-20.5-20.588-20.5-49.5Q660-424 680.589-444.5q20.588-20.5 49.5-20.5Q759-465 779.5-444.411q20.5 20.588 20.5 49.5Q800-366 779.411-345.5q-20.588 20.5-49.5 20.5Zm-500-170Q201-495 180.5-515.589q-20.5-20.588-20.5-49.5Q160-594 180.589-614.5q20.588-20.5 49.5-20.5Q259-635 279.5-614.411q20.5 20.588 20.5 49.5Q300-536 279.411-515.5q-20.588 20.5-49.5 20.5Zm335 0Q536-495 515.5-515.589q-20.5-20.588-20.5-49.5Q495-594 515.589-614.5q20.588-20.5 49.5-20.5Q594-635 614.5-614.411q20.5 20.588 20.5 49.5Q635-536 614.411-515.5q-20.588 20.5-49.5 20.5Zm-170-165Q366-660 345.5-680.589q-20.5-20.588-20.5-49.5Q325-759 345.589-779.5q20.588-20.5 49.5-20.5Q424-800 444.5-779.411q20.5 20.588 20.5 49.5Q465-701 444.411-680.5q-20.588 20.5-49.5 20.5Zm335 0Q701-660 680.5-680.589q-20.5-20.588-20.5-49.5Q660-759 680.589-779.5q20.588-20.5 49.5-20.5Q759-800 779.5-779.411q20.5 20.588 20.5 49.5Q800-701 779.411-680.5q-20.588 20.5-49.5 20.5Z"/></svg>`,
    PLUGIN_AI_BOT: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bot-icon lucide-bot"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`,
    PLUGIN_AI_BRAIN: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-brain-icon lucide-brain"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/></svg>`,
};

export const generateRandomString = () => {
    return Math.floor(Math.random() * Date.now()).toString(6);
};

export const downloadZipFile = async (url: string) => {
    const fetched = await requestUrl({ url });
    const bytes = fetched.arrayBuffer;
    return bytes;
};

export const extractToFold = async (writer: App, zipBytes: ArrayBuffer, targetPath: string) => {
    const zip = new JSZip();
    zip.loadAsync(zipBytes);
    zip.forEach(async (_, file) => {
        const data = await zip.file(file.name)?.async("string");
        if (data) {
            const path2Write = normalizePath(targetPath + '/' + file.name);
            writer.vault.adapter.write(path2Write, data);
        }
    });
}

export const extractFile = async (zipBytes: ArrayBuffer, fileName: string) => {
    let zip = new JSZip();
    zip = await zip.loadAsync(zipBytes);
    // the downloaded zip file might have root directory which is defined by github actions,
    // filter the file path with the given file name which is unique in release.
    const fileReg = new RegExp(`.*${fileName}$`);
    const file = zip.file(fileReg);

    if (file) {
        // the result of RegExp matching must be one item
        return await file[0].async("string");
    } else {
        return null;
    }
}

// code from https://github.com/meld-cp/obsidian-encrypt/blob/main/src/services/CryptoHelper.ts
const vectorSize = 16;
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();
const iterations = 1000;
const salt = utf8Encoder.encode('XHWnDAT6ehMVY2zD');
export const personalAssitant = "personal-assistant-plugin-api-token";
export const queryAI = "X-Api-Auth=36fb38ddc202fec";

export class CryptoHelper {

    // constructor(){
    // 	console.debug('new CryptoHelper');
    // }

    private async deriveKey(password: string): Promise<CryptoKey> {
        const buffer = utf8Encoder.encode(password);
        const key = await crypto.subtle.importKey('raw', buffer, { name: 'PBKDF2' }, false, ['deriveKey']);
        const privateKey = crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                hash: { name: 'SHA-256' },
                iterations,
                salt
            },
            key,
            {
                name: 'AES-GCM',
                length: 256
            },
            false,
            ['encrypt', 'decrypt']
        );

        return privateKey;
    }

    public async encryptToBytes(text: string, password: string): Promise<Uint8Array> {

        const key = await this.deriveKey(password);

        const textBytesToEncrypt = utf8Encoder.encode(text);
        const vector = crypto.getRandomValues(new Uint8Array(vectorSize));

        // encrypt into bytes
        const encryptedBytes = new Uint8Array(
            await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: vector },
                key,
                textBytesToEncrypt
            )
        );

        const finalBytes = new Uint8Array(vector.byteLength + encryptedBytes.byteLength);
        finalBytes.set(vector, 0);
        finalBytes.set(encryptedBytes, vector.byteLength);

        return finalBytes;
    }

    private convertToString(bytes: Uint8Array): string {
        let result = '';
        for (let idx = 0; idx < bytes.length; idx++) {
            // append to result
            result += String.fromCharCode(bytes[idx]);
        }
        return result;
    }

    public async encryptToBase64(text: string, password: string): Promise<string> {

        const finalBytes = await this.encryptToBytes(text, password);

        //convert array to base64
        const base64Text = btoa(this.convertToString(finalBytes));

        return base64Text;
    }

    private stringToArray(str: string): Uint8Array {
        const result = [];
        for (let i = 0; i < str.length; i++) {
            result.push(str.charCodeAt(i));
        }
        return new Uint8Array(result);
    }

    public async decryptFromBytes(encryptedBytes: Uint8Array, password: string): Promise<string | null> {
        try {

            // extract iv
            const vector = encryptedBytes.slice(0, vectorSize);

            // extract encrypted text
            const encryptedTextBytes = encryptedBytes.slice(vectorSize);

            const key = await this.deriveKey(password);

            // decrypt into bytes
            const decryptedBytes = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: vector },
                key,
                encryptedTextBytes
            );

            // convert bytes to text
            const decryptedText = utf8Decoder.decode(decryptedBytes);
            return decryptedText;
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    public async decryptFromBase64(base64Encoded: string, password: string): Promise<string | null> {
        try {

            const bytesToDecode = this.stringToArray(atob(base64Encoded));

            return await this.decryptFromBytes(bytesToDecode, password);

            // // extract iv
            // const vector = bytesToDecode.slice(0,vectorSize);

            // // extract encrypted text
            // const encryptedTextBytes = bytesToDecode.slice(vectorSize);

            // const key = await this.deriveKey(password);

            // // decrypt into bytes
            // let decryptedBytes = await crypto.subtle.decrypt(
            // 	{name: 'AES-GCM', iv: vector},
            // 	key,
            // 	encryptedTextBytes
            // );

            // // convert bytes to text
            // let decryptedText = utf8Decoder.decode(decryptedBytes);
            // return decryptedText;
        } catch (e) {
            console.error(e);
            return null;
        }
    }

}

export const isPluginEnabled = (app: App, pluginID: string) => {
    return (
        (app as any).plugins.manifests.hasOwnProperty(pluginID) && (app as any).plugins.enabledPlugins.has(pluginID) // eslint-disable-line @typescript-eslint/no-explicit-any
    );
};