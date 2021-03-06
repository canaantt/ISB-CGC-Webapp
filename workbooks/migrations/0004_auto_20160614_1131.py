# -*- coding: utf-8 -*-
# Generated by Django 1.9.6 on 2016-06-14 18:31
from __future__ import unicode_literals

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('workbooks', '0003_auto_20160304_1518'),
    ]

    operations = [
        migrations.AlterField(
            model_name='workbook',
            name='last_date_saved',
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.AlterField(
            model_name='workbook_last_view',
            name='last_view',
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.AlterField(
            model_name='worksheet',
            name='last_date_saved',
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.AlterField(
            model_name='worksheet_plot_cohort',
            name='cohort',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='worksheet_plot_cohorts', to='workbooks.Worksheet_cohort'),
        ),
    ]
