/**
 *
 * Copyright 2015, Institute for Systems Biology
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

define(['jquery',], function ($) {
    // Use 'yourlabs' as namespace.
    if (window.yourlabs == undefined) window.yourlabs = {};

    // Session security constructor. These are the required options:
    //
    // - pingUrl: url to ping with last activity in this tab to get global last
    //   activity time,
    // - warnAfter: number of seconds of inactivity before warning,
    // - expireAfter: number of seconds of inactivity before expiring the session.
    //
    // Optional options:
    //
    // - confirmFormDiscard: message that will be shown when the user tries to
    //   leave a page with unsaved form data. Setting this will enable an
    //   onbeforeunload handler that doesn't block expire().
    // - events: a list of event types to watch for activity updates.
    // - returnToUrl: a url to redirect users to expired sessions to. If this is not defined we just reload the page
    yourlabs.SessionSecurity = function(options) {
        // **HTML element** that should show to warn the user that his session will
        // expire.
        this.$warning = $('#session_security_warning');

        // Last recorded activity datetime.
        this.lastActivity = new Date();

        // Events that would trigger an activity
        this.events = ['mousemove', 'scroll', 'keyup', 'click'];

        // Merge the options dict here.
        $.extend(this, options);

        // Bind activity events to update this.lastActivity.
        for(var i=0; i<this.events.length; i++) {
            $(document)[this.events[i]]($.proxy(this.activity, this))
        }

        // Initialize timers.
        this.apply()

        if (this.confirmFormDiscard) {
            window.onbeforeunload = $.proxy(this.onbeforeunload, this);
            $(document).on('change', ':input', $.proxy(this.formChange, this));
            $(document).on('submit', 'form', $.proxy(this.formClean, this));
            $(document).on('reset', 'form', $.proxy(this.formClean, this));
        }
    }

    yourlabs.SessionSecurity.prototype = {
        // Called when there has been no activity for more than expireAfter
        // seconds.
        expire: function() {
            this.expired = true;
            if (this.returnToUrl !== undefined) {
                window.location.href = this.returnToUrl;
            }
            else {
                window.location.reload();
            }
        },

        // Called when there has been no activity for more than warnAfter
        // seconds.
        showWarning: function() {
            this.$warning.fadeIn('slow');
        },

        // Called to hide the warning, for example if there has been activity on
        // the server side - in another browser tab.
        hideWarning: function() {
            this.$warning.hide();
        },

        // Called by click, scroll, mousemove, keyup.
        activity: function() {
            var now = new Date();
            if (now - this.lastActivity < 1000)
                // Throttle these checks to once per second
                return;

            this.lastActivity = now;

            if (this.$warning.is(':visible')) {
                // Inform the server that the user came back manually, this should
                // block other browser tabs from expiring.
                this.ping();
            }

            this.hideWarning();
        },

        // Hit the PingView with the number of seconds since last activity.
        ping: function() {
            var idleFor = Math.floor((new Date() - this.lastActivity) / 1000);

            $.ajax(this.pingUrl, {
                data: {idleFor: idleFor},
                cache: false,
                success: $.proxy(this.pong, this),
                // In case of network error, we still want to hide potentially
                // confidential data !!
                error: $.proxy(this.apply, this),
                dataType: 'json',
                type: 'get'
            });
        },

        // Callback to process PingView response.
        pong: function(data) {
            if (data == 'logout') return this.expire();

            this.lastActivity = new Date();
            this.lastActivity.setSeconds(this.lastActivity.getSeconds() - data);
            this.apply();
        },

        // Apply warning or expiry, setup next ping
        apply: function() {
            // Cancel timeout if any, since we're going to make our own
            clearTimeout(this.timeout);

            var idleFor = Math.floor((new Date() - this.lastActivity) / 1000);

            if (idleFor >= this.expireAfter) {
                return this.expire();
            } else if (idleFor >= this.warnAfter) {
                this.showWarning();
                nextPing = this.expireAfter - idleFor;
            } else {
                this.hideWarning();
                nextPing = this.warnAfter - idleFor;
            }

            this.timeout = setTimeout($.proxy(this.ping, this), nextPing * 1000);
        },

        // onbeforeunload handler.
        onbeforeunload: function(e) {
            if ($('form[data-dirty]').length && !this.expired) {
                return this.confirmFormDiscard;
            }
        },

        // When an input change, set data-dirty attribute on its form.
        formChange: function(e) {
            $(e.target).closest('form').attr('data-dirty', true);
        },

        // When a form is submitted or resetted, unset data-dirty attribute.
        formClean: function(e) {
            $(e.target).removeAttr('data-dirty');
        }
    }

    var sessionSecurity = new yourlabs.SessionSecurity({
        pingUrl: pingUrl,
        warnAfter: warnAfter,
        expireAfter: expireAfter,
        confirmFormDiscard: confirmFormDiscard,
        returnToUrl: BASE_URL
    });


});
